package com.vishwas.safety;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge starts.
        registerPlugin(VishwasNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
