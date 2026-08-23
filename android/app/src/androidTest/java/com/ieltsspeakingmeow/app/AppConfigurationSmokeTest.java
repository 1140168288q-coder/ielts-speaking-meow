package com.ieltsspeakingmeow.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import android.Manifest;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppConfigurationSmokeTest {
    private static final String APPLICATION_ID = "com.ieltsspeakingmeow.app";

    @Test
    public void appUsesExpectedApplicationIdAndPrivateBackupPolicy() {
        Context appContext = InstrumentationRegistry
            .getInstrumentation()
            .getTargetContext();

        assertEquals(APPLICATION_ID, appContext.getPackageName());
        assertFalse(
            "Private recordings and transcripts must not be backed up",
            (appContext.getApplicationInfo().flags & ApplicationInfo.FLAG_ALLOW_BACKUP) != 0
        );
    }

    @Test
    public void appDoesNotRequestMicrophonePermission() throws Exception {
        Context appContext = InstrumentationRegistry
            .getInstrumentation()
            .getTargetContext();
        PackageInfo packageInfo = appContext
            .getPackageManager()
            .getPackageInfo(APPLICATION_ID, PackageManager.GET_PERMISSIONS);
        List<String> permissions = Arrays.asList(packageInfo.requestedPermissions);

        assertFalse(permissions.contains(Manifest.permission.RECORD_AUDIO));
    }
}
