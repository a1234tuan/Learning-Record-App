package com.noteproject.study408;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativeAi")
public class NativeAiPlugin extends Plugin {
    @PluginMethod
    public void chat(PluginCall call) {
        String baseUrl = call.getString("baseUrl", "");
        String apiKey = call.getString("apiKey", "");
        String model = call.getString("model", "");
        String messagesJson = call.getString("messagesJson", "[]");
        double temperature = call.getDouble("temperature", 0.7);
        int maxTokens = call.getInt("maxTokens", 4096);

        if (baseUrl.trim().isEmpty() || apiKey.trim().isEmpty() || model.trim().isEmpty()) {
            call.reject("AI 接口配置不完整。");
            return;
        }

        execute(() -> {
            try {
                JSONArray messages = new JSONArray(messagesJson);
                JSONObject payload = new JSONObject();
                payload.put("model", model);
                payload.put("messages", messages);
                payload.put("temperature", temperature);
                payload.put("max_tokens", maxTokens);

                HttpURLConnection connection = openConnection(normalizeChatUrl(baseUrl));
                connection.setRequestProperty("Authorization", "Bearer " + apiKey);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setDoOutput(true);

                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }

                String body = readResponse(connection);
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) {
                    call.reject("AI 接口请求失败：" + code + " " + body);
                    return;
                }

                JSONObject json = new JSONObject(body);
                JSONArray choices = json.optJSONArray("choices");
                if (choices == null || choices.length() == 0) {
                    call.reject("AI 接口返回为空，或不是 OpenAI 兼容格式。");
                    return;
                }
                JSONObject first = choices.optJSONObject(0);
                JSONObject message = first != null ? first.optJSONObject("message") : null;
                String content = message != null ? message.optString("content", "") : first != null ? first.optString("text", "") : "";
                if (content.trim().isEmpty()) {
                    call.reject("AI 接口返回为空。");
                    return;
                }

                JSObject result = new JSObject();
                result.put("content", content.trim());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "AI 请求失败。", error);
            }
        });
    }

    private String normalizeChatUrl(String baseUrl) {
        String trimmed = baseUrl.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        if (trimmed.endsWith("/chat/completions")) {
            return trimmed;
        }
        return trimmed + "/chat/completions";
    }

    private HttpURLConnection openConnection(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(30000);
        connection.setReadTimeout(120000);
        return connection;
    }

    private String readResponse(HttpURLConnection connection) throws Exception {
        InputStream input = connection.getResponseCode() >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (input == null) {
            return "";
        }
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append("\n");
            }
            return builder.toString().trim();
        }
    }
}
