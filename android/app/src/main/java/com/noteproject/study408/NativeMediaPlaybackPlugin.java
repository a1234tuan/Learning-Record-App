package com.noteproject.study408;

import android.Manifest;
import android.content.ComponentName;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.io.File;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(
    name = "NativeMediaPlayback",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public final class NativeMediaPlaybackPlugin extends Plugin {
    private static final String TAG = "NativeMediaPlayback";
    private static final long PREPARE_TIMEOUT_MS = 10_000L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaController controller;
    private ListenableFuture<MediaController> controllerFuture;
    private boolean progressUpdatesRunning;
    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            emitState();
            if (controller != null && controller.isPlaying()) {
                handler.postDelayed(this, 1_000L);
            } else {
                progressUpdatesRunning = false;
            }
        }
    };
    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onEvents(Player player, Player.Events events) {
            emitState();
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            emitState();
            if (isPlaying && !progressUpdatesRunning) {
                progressUpdatesRunning = true;
                handler.post(progressRunnable);
            }
        }
    };

    @Override
    public void handleOnDestroy() {
        handler.post(() -> {
            handler.removeCallbacksAndMessages(null);
            if (controller != null) {
                controller.removeListener(playerListener);
                controller.release();
                controller = null;
            }
            if (controllerFuture != null) {
                controllerFuture.cancel(true);
                controllerFuture = null;
            }
        });
    }

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
    public void prepareAndPlay(PluginCall call) {
        JSArray rawItems = call.getArray("items");
        if (rawItems == null || rawItems.length() == 0) {
            call.reject("播放队列不能为空。");
            return;
        }
        List<MediaItem> items = new ArrayList<>();
        try {
            for (int index = 0; index < rawItems.length(); index += 1) {
                JSONObject item = rawItems.getJSONObject(index);
                if (item == null || item.optString("assetId", "").isEmpty() || item.optString("uri", "").isEmpty()) {
                    call.reject("播放队列包含无效音频。");
                    return;
                }
                File file = validateQueueItem(item);
                // Rebuild the URI from the verified file path so percent-encoded
                // titles and non-ASCII filenames cannot confuse the extractor.
                JSONObject canonical = new JSONObject(item.toString());
                canonical.put("uri", Uri.fromFile(file).toString());
                items.add(MediaPlaybackService.mediaItemFromJson(canonical));
            }
        } catch (Exception error) {
            call.reject("无法读取播放队列。", error);
            return;
        }
        int initialIndex = Math.max(0, Math.min(call.getInt("initialIndex", 0), items.size() - 1));
        long positionMs = Math.max(0L, Math.round(call.getDouble("positionSeconds", 0d) * 1_000d));
        float speed = call.getDouble("speed", 1d).floatValue();
        String mode = call.getString("mode", "order");
        withController(call, connected -> prepareAndPlay(call, connected, items, initialIndex, positionMs, speed, mode));
    }

    @PluginMethod public void play(PluginCall call) { withController(call, controller -> { controller.play(); call.resolve(); }); }
    @PluginMethod public void pause(PluginCall call) { withController(call, controller -> { controller.pause(); call.resolve(); }); }
    @PluginMethod public void next(PluginCall call) { withController(call, controller -> { controller.seekToNextMediaItem(); call.resolve(); }); }
    @PluginMethod public void previous(PluginCall call) { withController(call, controller -> { controller.seekToPreviousMediaItem(); call.resolve(); }); }
    @PluginMethod public void seekBy(PluginCall call) { withController(call, controller -> { controller.seekTo(Math.max(0L, controller.getCurrentPosition() + Math.round(call.getDouble("offsetSeconds", 0d) * 1_000d))); call.resolve(); }); }
    @PluginMethod public void seekTo(PluginCall call) { withController(call, controller -> { controller.seekTo(Math.max(0L, Math.round(call.getDouble("positionSeconds", 0d) * 1_000d))); call.resolve(); }); }
    @PluginMethod public void setSpeed(PluginCall call) { withController(call, controller -> { controller.setPlaybackParameters(new PlaybackParameters(call.getDouble("speed", 1d).floatValue())); call.resolve(); }); }
    @PluginMethod public void setMode(PluginCall call) { withController(call, controller -> { applyMode(controller, call.getString("mode", "order")); call.resolve(); }); }

    @PluginMethod
    public void stop(PluginCall call) {
        withController(call, connected -> {
            connected.stop();
            connected.clearMediaItems();
            MediaPlaybackService.clearSavedState(getContext());
            call.resolve();
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        handler.post(() -> getStateOnMain(call));
    }

    private void getStateOnMain(PluginCall call) {
        JSObject result = new JSObject();
        if (controller != null) {
            result.put("state", stateFor(controller));
        } else {
            String persisted = MediaPlaybackService.readState(getContext());
            if (!persisted.isEmpty()) {
                try { result.put("state", stateForPersisted(new JSONObject(persisted))); } catch (Exception ignored) { }
            }
        }
        call.resolve(result);
    }

    @PluginMethod
    public void getAvailableBytes(PluginCall call) {
        android.os.StatFs stats = new android.os.StatFs(getContext().getFilesDir().getAbsolutePath());
        JSObject result = new JSObject();
        result.put("availableBytes", stats.getAvailableBytes());
        call.resolve(result);
    }

    private interface ControllerAction { void run(MediaController controller); }

    private File validateQueueItem(JSONObject item) {
        Uri uri = Uri.parse(item.optString("uri", ""));
        if (!"file".equals(uri.getScheme()) || uri.getPath() == null) {
            throw new IllegalArgumentException("播放队列包含不受支持的音频地址。");
        }
        File file = new File(uri.getPath());
        if (!file.isFile() || !file.canRead() || file.length() == 0L) {
            throw new IllegalArgumentException("播放队列包含不存在、不可读或为空的音频文件。");
        }
        String mimeType = item.optString("mimeType", "");
        if (!mimeType.isEmpty() && !mimeType.startsWith("audio/")) {
            throw new IllegalArgumentException("播放队列包含不支持的音频类型：" + mimeType);
        }
        return file;
    }

    private void prepareAndPlay(
        PluginCall call,
        MediaController connected,
        List<MediaItem> items,
        int initialIndex,
        long positionMs,
        float speed,
        String mode
    ) {
        final AtomicBoolean completed = new AtomicBoolean(false);
        final String expectedMediaId = items.get(initialIndex).mediaId;
        final Player.Listener[] listener = new Player.Listener[1];
        final Runnable timeout = () -> {
            if (completed.compareAndSet(false, true)) {
                connected.removeListener(listener[0]);
                connected.stop();
                Log.e(TAG, "Media3 prepare timeout for " + expectedMediaId);
                call.reject("Android 音频准备超时（10 秒），请重试；若持续失败请提供设备型号和 Android 版本。");
            }
        };
        listener[0] = new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                MediaItem current = connected.getCurrentMediaItem();
                if (playbackState == Player.STATE_READY && current != null && expectedMediaId.equals(current.mediaId) && completed.compareAndSet(false, true)) {
                    handler.removeCallbacks(timeout);
                    connected.removeListener(listener[0]);
                    call.resolve();
                }
            }

            @Override
            public void onPlayerError(androidx.media3.common.PlaybackException error) {
                if (completed.compareAndSet(false, true)) {
                    handler.removeCallbacks(timeout);
                    connected.removeListener(listener[0]);
                    String detail = safePlaybackErrorMessage(error);
                    Log.e(TAG, "Media3 playback error for " + expectedMediaId + ": " + detail, error);
                    call.reject("Android 无法解码该音频：" + detail, error);
                }
            }
        };
        try {
            connected.addListener(listener[0]);
            handler.postDelayed(timeout, PREPARE_TIMEOUT_MS);
            connected.setMediaItems(items, initialIndex, positionMs);
            applyMode(connected, mode);
            connected.setPlaybackParameters(new PlaybackParameters(speed));
            connected.prepare();
            connected.play();
        } catch (Exception error) {
            handler.removeCallbacks(timeout);
            connected.removeListener(listener[0]);
            if (completed.compareAndSet(false, true)) {
                Log.e(TAG, "Unable to start Media3 player", error);
                call.reject("无法启动 Android 播放器：" + safeErrorMessage(error), error);
            }
        }
    }

    private void withController(PluginCall call, ControllerAction action) {
        // MediaController is thread-confined to its application Looper. The
        // Capacitor bridge may invoke plugin methods off-main, so both creation
        // and every subsequent player operation must be posted to main.
        handler.post(() -> withControllerOnMain(call, action));
    }

    private void withControllerOnMain(PluginCall call, ControllerAction action) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            handler.post(() -> withControllerOnMain(call, action));
            return;
        }
        if (controller != null) {
            runControllerAction(call, controller, action);
            return;
        }
        if (controllerFuture == null) {
            SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), MediaPlaybackService.class));
            controllerFuture = new MediaController.Builder(getContext(), token)
                .setApplicationLooper(Looper.getMainLooper())
                .buildAsync();
        }
        ListenableFuture<MediaController> future = controllerFuture;
        future.addListener(() -> {
            try {
                controller = future.get();
                controller.addListener(playerListener);
                runControllerAction(call, controller, action);
            } catch (Exception error) {
                Log.e(TAG, "Unable to connect Media3 controller", error);
                call.reject("无法连接系统播放器：" + safeErrorMessage(error), error);
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    private void runControllerAction(PluginCall call, MediaController connected, ControllerAction action) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            handler.post(() -> runControllerAction(call, connected, action));
            return;
        }
        try {
            action.run(connected);
        } catch (Exception error) {
            call.reject("Android 播放器操作失败：" + safeErrorMessage(error), error);
        }
    }

    private static String safeErrorMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }

    private static String safePlaybackErrorMessage(androidx.media3.common.PlaybackException error) {
        String message = error.getMessage();
        if (message == null || message.isEmpty()) message = error.getClass().getSimpleName();
        Throwable cause = error.getCause();
        if (cause != null && cause.getMessage() != null && !cause.getMessage().isEmpty()) {
            message += "; cause=" + cause.getMessage();
        }
        return message + " (errorCode=" + error.errorCode + ")";
    }

    private void emitState() {
        if (controller == null) return;
        notifyListeners("stateChanged", stateFor(controller));
    }

    private static JSObject stateFor(MediaController controller) {
        JSObject state = new JSObject();
        MediaItem item = controller.getCurrentMediaItem();
        String status = item == null ? "idle" : controller.getPlaybackState() == Player.STATE_ENDED ? "ended" : controller.isPlaying() ? "playing" : "paused";
        state.put("status", status);
        state.put("index", Math.max(0, controller.getCurrentMediaItemIndex()));
        state.put("positionSeconds", controller.getCurrentPosition() / 1_000d);
        state.put("durationSeconds", Math.max(0L, controller.getDuration()) / 1_000d);
        state.put("speed", controller.getPlaybackParameters().speed);
        state.put("mode", modeFor(controller));
        if (item != null) {
            state.put("itemId", item.mediaId);
            if (item.mediaMetadata.extras != null) state.put("queueId", item.mediaMetadata.extras.getString("queueId", ""));
        }
        if (controller.getPlayerError() != null) state.put("error", String.valueOf(controller.getPlayerError().getMessage()));
        return state;
    }

    private static JSObject stateForPersisted(JSONObject snapshot) {
        JSObject state = new JSObject();
        JSONObject current = null;
        org.json.JSONArray items = snapshot.optJSONArray("items");
        int index = Math.max(0, snapshot.optInt("index", 0));
        if (items != null && items.length() > 0) {
            index = Math.min(index, items.length() - 1);
            current = items.optJSONObject(index);
        }
        boolean ended = "ended".equals(snapshot.optString("status", "paused"));
        state.put("status", current == null ? "idle" : ended ? "ended" : "paused");
        state.put("index", index);
        state.put("positionSeconds", Math.max(0L, snapshot.optLong("positionMs", 0L)) / 1_000d);
        state.put("durationSeconds", 0d);
        state.put("speed", (float) snapshot.optDouble("speed", 1d));
        state.put("mode", snapshot.optBoolean("shuffle", false) ? "shuffle" : snapshot.optInt("repeatMode", Player.REPEAT_MODE_OFF) == Player.REPEAT_MODE_ONE ? "single" : "order");
        if (current != null) state.put("itemId", current.optString("assetId", ""));
        if (!snapshot.optString("queueId", "").isEmpty()) state.put("queueId", snapshot.optString("queueId", ""));
        return state;
    }

    private static void applyMode(MediaController controller, String mode) {
        if ("single".equals(mode)) {
            controller.setRepeatMode(Player.REPEAT_MODE_ONE);
            controller.setShuffleModeEnabled(false);
        } else if ("shuffle".equals(mode)) {
            controller.setRepeatMode(Player.REPEAT_MODE_OFF);
            controller.setShuffleModeEnabled(true);
        } else {
            controller.setRepeatMode(Player.REPEAT_MODE_OFF);
            controller.setShuffleModeEnabled(false);
        }
    }

    private static String modeFor(MediaController controller) {
        if (controller.getShuffleModeEnabled()) return "shuffle";
        return controller.getRepeatMode() == Player.REPEAT_MODE_ONE ? "single" : "order";
    }
}
