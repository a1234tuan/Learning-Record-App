package com.noteproject.study408;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeAudioRecorderPlugin.class);
        registerPlugin(NativeOcrPlugin.class);
        registerPlugin(NativeAutoBackupPlugin.class);
        registerPlugin(NativeAiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
