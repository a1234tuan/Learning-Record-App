package com.noteproject.study408;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "NativePodcastTts",
    permissions = {
        @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
    }
)
public class NativePodcastTtsPlugin extends Plugin {
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String apiKey = call.getString("apiKey", "").trim();
        JSObject job = call.getObject("job");
        if (apiKey.isEmpty() || job == null || job.optString("jobId", "").isEmpty() || job.optString("podcastId", "").isEmpty()) {
            call.reject("后台播客音频任务参数不完整。");
            return;
        }
        PodcastTtsForegroundService.start(getContext(), job.toString(), apiKey);
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        String state = PodcastTtsForegroundService.readState(getContext());
        if (!state.isEmpty()) {
            try {
                JSONObject parsed = new JSONObject(state);
                parsed.put("runnerActive", PodcastTtsForegroundService.isServiceRunning());
                result.put("state", parsed.toString());
            } catch (Exception error) {
                result.put("state", state);
            }
        }
        call.resolve(result);
    }

    @PluginMethod
    public void takeNextArtifact(PluginCall call) {
        try {
            String artifact = PodcastTtsForegroundService.takeNextArtifact(getContext());
            JSObject result = new JSObject();
            if (!artifact.isEmpty()) result.put("artifact", new JSONObject(artifact));
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() != null ? error.getMessage() : "无法读取后台生成的音频。", error);
        }
    }

    @PluginMethod
    public void acknowledgeArtifact(PluginCall call) {
        String jobId = call.getString("jobId", "");
        String unitId = call.getString("unitId", "");
        if (jobId.isEmpty() || unitId.isEmpty()) {
            call.reject("缺少后台音频标识。");
            return;
        }
        PodcastTtsForegroundService.acknowledgeArtifact(getContext(), jobId, unitId);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        PodcastTtsForegroundService.cancel(getContext(), call.getString("jobId", ""), call.getString("podcastId", ""));
        call.resolve();
    }
}
