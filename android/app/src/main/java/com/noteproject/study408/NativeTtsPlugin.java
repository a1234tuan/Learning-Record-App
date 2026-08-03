package com.noteproject.study408;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativeTts")
public class NativeTtsPlugin extends Plugin {
    @PluginMethod
    public void synthesize(PluginCall call) {
        String apiKey = call.getString("apiKey", "");
        String model = call.getString("model", "s2.1-pro-free");
        String voiceId = call.getString("voiceId", "");
        String text = call.getString("text", "");
        if (apiKey.trim().isEmpty() || voiceId.trim().isEmpty() || text.trim().isEmpty()) {
            call.reject("Fish Audio 请求配置不完整。");
            return;
        }
        execute(() -> {
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL("https://api.fish.audio/v1/tts").openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(30000);
                connection.setReadTimeout(120000);
                connection.setRequestProperty("Authorization", "Bearer " + apiKey.trim());
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Accept", "audio/mpeg");
                connection.setRequestProperty("model", model.trim());
                connection.setDoOutput(true);
                JSONObject payload = new JSONObject();
                payload.put("text", text);
                payload.put("reference_id", voiceId);
                payload.put("format", "mp3");
                payload.put("normalize", true);
                payload.put("mp3_bitrate", 128);
                payload.put("latency", "normal");
                payload.put("chunk_length", 300);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }
                int code = connection.getResponseCode();
                InputStream input = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
                byte[] bytes = readAll(input);
                if (code < 200 || code >= 300) {
                    String detail = new String(bytes, StandardCharsets.UTF_8).replaceAll("\\s+", " ").trim();
                    call.reject("Fish Audio 请求失败（" + code + "）：" + (detail.length() > 180 ? detail.substring(0, 180) : detail));
                    return;
                }
                JSObject result = new JSObject();
                result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                result.put("mimeType", "audio/mpeg");
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "Fish Audio 请求失败。", error);
            }
        });
    }

    private byte[] readAll(InputStream input) throws Exception {
        if (input == null) return new byte[0];
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = stream.read(buffer)) != -1) output.write(buffer, 0, length);
            return output.toByteArray();
        }
    }
}
