package com.ieltsspeakingmeow.app;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Stores only the cloud session token, encrypted with an Android Keystore key. */
@CapacitorPlugin(name = "SecureSession")
public class SecureSessionPlugin extends Plugin {
    private static final String KEY_ALIAS = "ielts_meow_cloud_session_v1";
    private static final String PREFERENCES = "ielts_meow_secure_session";
    private static final String TOKEN = "cloud_auth_token";
    private static final String IV = "cloud_auth_iv";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    @PluginMethod
    public void setToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.trim().isEmpty()) {
            call.reject("A non-empty session token is required.", "INVALID_TOKEN");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            preferences().edit()
                .putString(TOKEN, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("The session could not be stored securely.", "SECURE_STORAGE_WRITE_FAILED");
        }
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        String encryptedValue = preferences().getString(TOKEN, null);
        String ivValue = preferences().getString(IV, null);
        JSObject result = new JSObject();
        if (encryptedValue == null || ivValue == null) {
            result.put("token", JSONObject.NULL);
            call.resolve(result);
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                new GCMParameterSpec(128, Base64.decode(ivValue, Base64.NO_WRAP))
            );
            byte[] decrypted = cipher.doFinal(Base64.decode(encryptedValue, Base64.NO_WRAP));
            result.put("token", new String(decrypted, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            preferences().edit().remove(TOKEN).remove(IV).apply();
            result.put("token", JSONObject.NULL);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        preferences().edit().remove(TOKEN).remove(IV).apply();
        call.resolve();
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, 0);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }
}
