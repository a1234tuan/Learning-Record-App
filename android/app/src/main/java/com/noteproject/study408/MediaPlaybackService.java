package com.noteproject.study408;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.Bundle;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.CommandButton;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Owns the Android playback session. Web code only talks to this service through MediaController. */
public final class MediaPlaybackService extends MediaSessionService {
    private static final String PREFS = "media_playback_state";
    private static final String PREF_STATE = "state";
    private static final String EXTRA_QUEUE_ID = "queueId";
    private static final long PERSIST_INTERVAL_MS = 1_000L;
    private static volatile MediaPlaybackService activeInstance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable persistRunnable = new Runnable() {
        @Override
        public void run() {
            persistState();
            if (player != null && player.isPlaying()) {
                handler.postDelayed(this, PERSIST_INTERVAL_MS);
            }
        }
    };

    private ExoPlayer player;
    private MediaSession mediaSession;

    public static String readState(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_STATE, "");
    }

    public static void clearSavedState(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PREF_STATE).apply();
    }

    public static void pauseForRecording(Context context) {
        // A recording should never capture playback from the device speaker.
        MediaPlaybackService service = activeInstance;
        if (service != null && service.player != null) {
            service.player.pause();
        }
        JSONObject snapshot = readStateObject(context);
        if (snapshot != null) {
            try {
                snapshot.put("wasPlaying", false);
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_STATE, snapshot.toString()).apply();
            } catch (Exception ignored) { }
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
            .build();
        player = new ExoPlayer.Builder(this)
            .setAudioAttributes(attributes, true)
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(10_000L)
            .setSeekForwardIncrementMs(10_000L)
            .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onEvents(Player ignored, Player.Events events) {
                persistState();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                handler.removeCallbacks(persistRunnable);
                persistState();
                if (isPlaying) {
                    handler.post(persistRunnable);
                }
            }
        });
        mediaSession = new MediaSession.Builder(this, player).build();
        mediaSession.setMediaButtonPreferences(Arrays.asList(
            new CommandButton.Builder(CommandButton.ICON_PREVIOUS)
                .setPlayerCommand(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .setDisplayName("上一首")
                .setSlots(CommandButton.SLOT_BACK)
                .build(),
            new CommandButton.Builder(CommandButton.ICON_PLAY)
                .setPlayerCommand(Player.COMMAND_PLAY_PAUSE)
                .setDisplayName("播放或暂停")
                .setSlots(CommandButton.SLOT_CENTRAL)
                .build(),
            new CommandButton.Builder(CommandButton.ICON_NEXT)
                .setPlayerCommand(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .setDisplayName("下一首")
                .setSlots(CommandButton.SLOT_FORWARD)
                .build(),
            new CommandButton.Builder(CommandButton.ICON_SKIP_BACK_10)
                .setPlayerCommand(Player.COMMAND_SEEK_BACK)
                .setDisplayName("后退 10 秒")
                .setSlots(CommandButton.SLOT_BACK_SECONDARY)
                .build(),
            new CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD_10)
                .setPlayerCommand(Player.COMMAND_SEEK_FORWARD)
                .setDisplayName("前进 10 秒")
                .setSlots(CommandButton.SLOT_FORWARD_SECONDARY)
                .build()
        ));
        restorePausedSession();
    }

    @Override
    public int onStartCommand(@Nullable android.content.Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);
        return START_STICKY;
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onTaskRemoved(android.content.Intent rootIntent) {
        // Keep the foreground media session alive after the user removes the app task.
        persistState();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        persistState();
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        activeInstance = null;
        super.onDestroy();
    }

    private void restorePausedSession() {
        JSONObject snapshot = readStateObject(this);
        if (snapshot == null || player == null) return;
        try {
            JSONArray items = snapshot.optJSONArray("items");
            if (items == null || items.length() == 0) return;
            List<MediaItem> restored = new ArrayList<>();
            for (int index = 0; index < items.length(); index += 1) {
                JSONObject item = items.optJSONObject(index);
                if (item == null) continue;
                String uri = item.optString("uri", "");
                if (uri.isEmpty() || !new File(android.net.Uri.parse(uri).getPath()).isFile()) continue;
                restored.add(mediaItemFromJson(item));
            }
            if (restored.isEmpty()) {
                clearSavedState(this);
                return;
            }
            int savedIndex = Math.max(0, Math.min(snapshot.optInt("index", 0), restored.size() - 1));
            long positionMs = Math.max(0L, snapshot.optLong("positionMs", 0L));
            player.setMediaItems(restored, savedIndex, positionMs);
            player.setPlaybackParameters(new androidx.media3.common.PlaybackParameters((float) snapshot.optDouble("speed", 1d)));
            player.setRepeatMode(snapshot.optInt("repeatMode", Player.REPEAT_MODE_OFF));
            player.setShuffleModeEnabled(snapshot.optBoolean("shuffle", false));
            player.prepare();
            player.pause();
        } catch (Exception ignored) {
            clearSavedState(this);
        }
    }

    private void persistState() {
        if (player == null || player.getMediaItemCount() == 0) return;
        try {
            JSONObject snapshot = new JSONObject();
            snapshot.put("status", player.getPlaybackState() == Player.STATE_ENDED ? "ended" : player.isPlaying() ? "playing" : "paused");
            snapshot.put("index", Math.max(0, player.getCurrentMediaItemIndex()));
            snapshot.put("positionMs", Math.max(0L, player.getCurrentPosition()));
            snapshot.put("speed", player.getPlaybackParameters().speed);
            snapshot.put("repeatMode", player.getRepeatMode());
            snapshot.put("shuffle", player.getShuffleModeEnabled());
            JSONArray items = new JSONArray();
            for (int index = 0; index < player.getMediaItemCount(); index += 1) {
                MediaItem item = player.getMediaItemAt(index);
                items.put(mediaItemToJson(item));
                if (index == 0 && item.mediaMetadata.extras != null) {
                    snapshot.put("queueId", item.mediaMetadata.extras.getString(EXTRA_QUEUE_ID, ""));
                }
            }
            snapshot.put("items", items);
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_STATE, snapshot.toString()).apply();
        } catch (Exception ignored) {
            // Persisting state is recoverability only; it must not interrupt playback.
        }
    }

    private static JSONObject readStateObject(Context context) {
        try {
            String state = readState(context);
            return state.isEmpty() ? null : new JSONObject(state);
        } catch (Exception ignored) {
            return null;
        }
    }

    static MediaItem mediaItemFromJson(JSONObject value) {
        Bundle extras = new Bundle();
        extras.putString(EXTRA_QUEUE_ID, value.optString("queueId", ""));
        MediaMetadata metadata = new MediaMetadata.Builder()
            .setTitle(value.optString("title", ""))
            .setArtist(value.optString("subtitle", ""))
            .setExtras(extras)
            .build();
        return new MediaItem.Builder()
            .setMediaId(value.optString("assetId", ""))
            .setUri(value.optString("uri", ""))
            .setMimeType(value.optString("mimeType", ""))
            .setMediaMetadata(metadata)
            .build();
    }

    private static JSONObject mediaItemToJson(MediaItem item) throws Exception {
        JSONObject value = new JSONObject();
        value.put("assetId", item.mediaId);
        value.put("uri", item.localConfiguration != null ? item.localConfiguration.uri.toString() : "");
        value.put("mimeType", item.localConfiguration != null && item.localConfiguration.mimeType != null ? item.localConfiguration.mimeType : "");
        value.put("title", String.valueOf(item.mediaMetadata.title != null ? item.mediaMetadata.title : ""));
        value.put("subtitle", String.valueOf(item.mediaMetadata.artist != null ? item.mediaMetadata.artist : ""));
        value.put("queueId", item.mediaMetadata.extras != null ? item.mediaMetadata.extras.getString(EXTRA_QUEUE_ID, "") : "");
        return value;
    }
}
