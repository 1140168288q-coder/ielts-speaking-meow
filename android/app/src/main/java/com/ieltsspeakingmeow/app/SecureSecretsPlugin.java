package com.ieltsspeakingmeow.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Encrypts the three provider API keys with a non-exportable Android Keystore key. */
@CapacitorPlugin(name = "SecureSecrets")
public class SecureSecretsPlugin extends Plugin {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "ielts-speaking-meow.secure-secrets.v1";
    private static final String PREFERENCES_NAME = "ielts-speaking-meow.secure-secrets";
    private static final String RECORD_VERSION = "v1";
    private static final int GCM_TAG_BITS = 128;
    private static final int EXPECTED_IV_BYTES = 12;
    private static final int MAX_SECRET_CHARACTERS = 16_384;
    private static final Set<String> ALLOWED_NAMES = new HashSet<>(
        Arrays.asList("text-ai-api-key", "voice-ai-api-key", "stt-api-key")
    );

    @PluginMethod
    public void get(PluginCall call) {
        String name = validatedName(call);
        if (name == null) {
            return;
        }

        String record = preferences().getString(preferenceKey(name), null);
        if (record == null) {
            JSObject response = new JSObject();
            response.put("value", JSONObject.NULL);
            call.resolve(response);
            return;
        }

        try {
            String value = decrypt(name, record);
            JSObject response = new JSObject();
            response.put("value", value);
            call.resolve(response);
        } catch (GeneralSecurityException | IOException | IllegalArgumentException error) {
            call.reject("The saved API key could not be decrypted.", "SECRET_UNAVAILABLE");
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String name = validatedName(call);
        if (name == null) {
            return;
        }

        String value = call.getString("value");
        if (
            value == null ||
            value.trim().isEmpty() ||
            value.length() > MAX_SECRET_CHARACTERS
        ) {
            call.reject("The API key must be non-empty and no longer than 16384 characters.", "INVALID_SECRET");
            return;
        }

        try {
            String record = encrypt(name, value);
            boolean committed = preferences()
                .edit()
                .putString(preferenceKey(name), record)
                .commit();
            if (!committed) {
                call.reject("The API key could not be saved.", "SECRET_STORAGE_FAILED");
                return;
            }
            call.resolve();
        } catch (GeneralSecurityException | IOException error) {
            call.reject("Secure API key storage is unavailable.", "SECRET_UNAVAILABLE");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String name = validatedName(call);
        if (name == null) {
            return;
        }

        boolean committed = preferences()
            .edit()
            .remove(preferenceKey(name))
            .commit();
        if (!committed) {
            call.reject("The API key could not be removed.", "SECRET_STORAGE_FAILED");
            return;
        }
        call.resolve();
    }

    private String validatedName(PluginCall call) {
        String name = call.getString("name");
        if (name == null || !ALLOWED_NAMES.contains(name)) {
            call.reject("Unknown secure secret name.", "INVALID_SECRET_NAME");
            return null;
        }
        return name;
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private static String preferenceKey(String name) {
        return "secret." + name;
    }

    private static byte[] associatedData(String name) {
        return (RECORD_VERSION + ":" + name).getBytes(StandardCharsets.UTF_8);
    }

    private static String encrypt(String name, String value)
        throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        cipher.updateAAD(associatedData(name));
        byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));

        return (
            RECORD_VERSION +
            ":" +
            Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) +
            ":" +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
        );
    }

    private static String decrypt(String name, String record)
        throws GeneralSecurityException, IOException, IllegalArgumentException {
        String[] fields = record.split(":", 3);
        if (fields.length != 3 || !RECORD_VERSION.equals(fields[0])) {
            throw new IllegalArgumentException("Unsupported encrypted secret record.");
        }

        byte[] iv = Base64.decode(fields[1], Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(fields[2], Base64.NO_WRAP);
        if (iv.length != EXPECTED_IV_BYTES || ciphertext.length <= GCM_TAG_BITS / 8) {
            throw new IllegalArgumentException("Malformed encrypted secret record.");
        }

        SecretKey key = getExistingKey();
        if (key == null) {
            throw new GeneralSecurityException("The secure secret key is unavailable.");
        }

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
        cipher.updateAAD(associatedData(name));
        byte[] plaintext = cipher.doFinal(ciphertext);
        return new String(plaintext, StandardCharsets.UTF_8);
    }

    private static SecretKey getOrCreateKey()
        throws GeneralSecurityException, IOException {
        SecretKey existing = getExistingKey();
        if (existing != null) {
            return existing;
        }

        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE_PROVIDER
        );
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }

    private static SecretKey getExistingKey()
        throws GeneralSecurityException, IOException {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
        keyStore.load(null);
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            return null;
        }
        return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
    }
}
