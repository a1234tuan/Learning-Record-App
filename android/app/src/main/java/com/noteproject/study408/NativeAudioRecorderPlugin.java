package com.noteproject.study408;

import android.Manifest;
import android.media.MediaRecorder;
import android.os.Build;
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
    private MediaRecorder recorder;
    private File outputFile;
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
            target.reject("麦克风权限被拒绝，请在 MIUI 设置中允许本 App 使用麦克风。");
        }
    }

    private void startRecording(PluginCall call) {
        if (recorder != null) {
            call.reject("录音已经在进行中。");
            return;
        }
        try {
            outputFile = new File(getContext().getCacheDir(), "recording-" + System.currentTimeMillis() + ".m4a");
            recorder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? new MediaRecorder(getContext())
                : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioEncodingBitRate(128000);
            recorder.setAudioSamplingRate(44100);
            recorder.setOutputFile(outputFile.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            call.resolve();
        } catch (Exception error) {
            cleanupRecorder();
            call.reject("无法启动录音：" + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (recorder == null || outputFile == null) {
            call.reject("当前没有正在进行的录音。");
            return;
        }
        try {
            recorder.stop();
        } catch (RuntimeException error) {
            cleanupRecorder();
            call.reject("录音时间过短或保存失败，请重新录制。", error);
            return;
        }
        cleanupRecorderOnly();
        try {
            byte[] bytes = readBytes(outputFile);
            JSObject result = new JSObject();
            result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            result.put("fileName", outputFile.getName());
            result.put("mimeType", "audio/mp4");
            call.resolve(result);
            outputFile.delete();
            outputFile = null;
        } catch (Exception error) {
            cleanupRecorder();
            call.reject("读取录音文件失败：" + error.getMessage(), error);
        }
    }

    private byte[] readBytes(File file) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
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

    private void cleanupRecorderOnly() {
        if (recorder != null) {
            recorder.reset();
            recorder.release();
            recorder = null;
        }
    }

    private void cleanupRecorder() {
        cleanupRecorderOnly();
        if (outputFile != null) {
            outputFile.delete();
            outputFile = null;
        }
    }
}
