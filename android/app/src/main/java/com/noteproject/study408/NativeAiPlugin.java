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
import org.json.JSONException;
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

                String requestUrl = normalizeChatUrl(baseUrl);
                HttpURLConnection connection = openConnection(requestUrl);
                connection.setRequestProperty("Authorization", "Bearer " + apiKey);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setDoOutput(true);

                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }

                String body = readResponse(connection);
                int code = connection.getResponseCode();
                String contentType = connection.getContentType() != null ? connection.getContentType() : "";
                if (code < 200 || code >= 300) {
                    call.reject("AI 接口请求失败：" + code + " " + extractErrorMessage(body, contentType, requestUrl));
                    return;
                }

                JSONObject json = parseJsonBody(body, contentType, code, requestUrl);
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

    private JSONObject parseJsonBody(String body, String contentType, int code, String requestUrl) throws JSONException {
        try {
            return new JSONObject(body);
        } catch (JSONException error) {
            String hint = isLikelyHtmlResponse(body, contentType)
                ? "接口返回的是 HTML 页面，Base URL 可能缺少 /v1 或填成了网页入口。"
                : "接口返回的不是 JSON。";
            throw new JSONException(
                "AI 接口返回的不是 OpenAI 兼容 JSON，可能 Base URL 路径错误。"
                    + formatResponseMeta(code, contentType, requestUrl)
                    + "，" + hint
                    + "响应片段：" + responseSnippet(body)
            );
        }
    }

    private String extractErrorMessage(String body, String contentType, String requestUrl) {
        try {
            JSONObject json = new JSONObject(body);
            JSONObject error = json.optJSONObject("error");
            String message = error != null ? error.optString("message", "") : json.optString("message", "");
            if (!message.trim().isEmpty()) {
                return message.trim();
            }
        } catch (JSONException ignored) {
            // Fall through to a compact response summary below.
        }

        if (isLikelyHtmlResponse(body, contentType)) {
            return "接口返回的是 HTML 页面，Base URL 可能缺少 /v1 或填成了网页入口。请求地址：" + requestUrl + "，响应片段：" + responseSnippet(body);
        }
        return responseSnippet(body);
    }

    private String formatResponseMeta(int code, String contentType, String requestUrl) {
        String meta = "HTTP " + code;
        if (contentType != null && !contentType.trim().isEmpty()) {
            meta += "，Content-Type：" + contentType.trim();
        }
        return meta + "，请求地址：" + requestUrl;
    }

    private boolean isLikelyHtmlResponse(String body, String contentType) {
        String lowerContentType = contentType != null ? contentType.toLowerCase() : "";
        String trimmed = body != null ? body.trim().toLowerCase() : "";
        return lowerContentType.contains("text/html") || trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
    }

    private String responseSnippet(String body) {
        if (body == null || body.trim().isEmpty()) {
            return "响应体为空。";
        }
        String compact = body.replaceAll("\\s+", " ").trim();
        return compact.length() > 180 ? compact.substring(0, 180) + "..." : compact;
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
