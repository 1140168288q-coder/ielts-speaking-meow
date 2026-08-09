package com.ieltsspeakingmeow.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentOcrPlugin.class);
        registerPlugin(SecureSecretsPlugin.class);
        registerPlugin(SystemTTSPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
