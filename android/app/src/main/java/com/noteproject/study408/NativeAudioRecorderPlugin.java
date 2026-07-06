package com.noteproject.study408;

import android.Manifest;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

@CapacitorPlugin(
    name = "NativeAudioRecorder",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class NativeAudioRecorderPlugin extends Plugin {
    private static final int START_CHECK_MAX_ATTEMPTS = 20;
    private static final long START_CHECK_DELAY_MS = 100L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PluginCall pendingStartCall;

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            pendingStartCall = call;
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        startRecording(call);
    }

    @PermissionCallback
    public void microphonePermissionCallback(PluginCall call) {
        PluginCall target = pendingStartCall != null ? pendingStartCall : call;
        pendingStartCall = null;
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            startRecording(target);
        } else {
            target.reject("麦克风权限被拒绝，请在系统设置中允许本 App 使用麦克风。");
        }
    }

    private void startRecording(PluginCall call) {
        if (AudioRecordingController.isRecording()) {
            call.reject("录音已经在进行中。");
            return;
        }
        try {
            RecordingForegroundService.start(getContext());
            waitForRecordingStart(call, 0);
        } catch (Exception error) {
            call.reject("无法启动录音：" + error.getMessage(), error);
        }
    }

    private void waitForRecordingStart(PluginCall call, int attempt) {
        mainHandler.postDelayed(() -> {
            if (AudioRecordingController.isRecording()) {
                call.resolve();
                return;
            }
            if (attempt >= START_CHECK_MAX_ATTEMPTS) {
                String lastError = AudioRecordingController.getLastError();
                call.reject(lastError != null ? lastError : "无法启动录音，请确认系统允许前台录音服务。");
                return;
            }
            waitForRecordingStart(call, attempt + 1);
        }, START_CHECK_DELAY_MS);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (!AudioRecordingController.isRecording()) {
            call.reject("当前没有正在进行的录音。");
            return;
        }

        File outputFile;
        try {
            outputFile = AudioRecordingController.stop();
            RecordingForegroundService.stop(getContext());
        } catch (Exception error) {
            RecordingForegroundService.stop(getContext());
            call.reject(error.getMessage() != null ? error.getMessage() : "停止录音失败。", error);
            return;
        }

        try {
            byte[] bytes = readBytes(outputFile);
            JSObject result = new JSObject();
            result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            result.put("fileName", outputFile.getName());
            result.put("mimeType", "audio/mp4");
            call.resolve(result);
            outputFile.delete();
        } catch (Exception error) {
            outputFile.delete();
            call.reject("读取录音文件失败：" + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("recording", AudioRecordingController.isRecording());
        long startedAt = AudioRecordingController.getStartedAt();
        if (startedAt > 0) {
            result.put("startedAt", startedAt);
        }
        call.resolve(result);
    }

    private byte[] readBytes(File file) throws IOException {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            return Files.readAllBytes(file.toPath());
        }
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        java.io.FileInputStream input = new java.io.FileInputStream(file);
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        input.close();
        return output.toByteArray();
    }
}
