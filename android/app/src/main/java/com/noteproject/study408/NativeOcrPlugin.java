package com.noteproject.study408;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativeOcr")
public class NativeOcrPlugin extends Plugin {
    private static final String JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
    private static final String TOKEN = "b0018c1b9dab00f633b3fabd9749729bc2bdc48a";
    private static final String MODEL = "PaddleOCR-VL-1.6";
    private static final int POLL_INTERVAL_MS = 5000;
    private static final int MAX_WAIT_MS = 5 * 60 * 1000;

    @PluginMethod
    public void recognize(PluginCall call) {
        String base64Data = call.getString("data");
        String fileName = call.getString("fileName", "image.png");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("OCR 图片数据为空。");
            return;
        }

        execute(() -> {
            try {
                byte[] imageBytes = Base64.decode(base64Data, Base64.DEFAULT);
                String jobId = submitJob(imageBytes, fileName, mimeType);
                String jsonUrl = pollJob(jobId);
                String text = extractText(readUrl(jsonUrl));
                if (text.trim().isEmpty()) {
                    call.reject("上游返回空 OCR 文本。");
                    return;
                }
                JSObject result = new JSObject();
                result.put("jobId", jobId);
                result.put("text", text.trim());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "OCR 识别失败。", error);
            }
        });
    }

    private String submitJob(byte[] imageBytes, String fileName, String mimeType) throws Exception {
        String boundary = "----Study408Boundary" + UUID.randomUUID();
        HttpURLConnection connection = openConnection(JOB_URL, "POST");
        connection.setRequestProperty("Authorization", "bearer " + TOKEN);
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        connection.setDoOutput(true);

        try (OutputStream output = connection.getOutputStream()) {
            writeFormField(output, boundary, "model", MODEL);
            writeFormField(
                output,
                boundary,
                "optionalPayload",
                "{\"useDocOrientationClassify\":true,\"useDocUnwarping\":true,\"useChartRecognition\":false}"
            );
            writeFileField(output, boundary, "file", fileName, mimeType, imageBytes);
            output.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        }

        String body = readResponse(connection);
        if (connection.getResponseCode() != 200) {
            throw new Exception("OCR 提交失败：" + connection.getResponseCode() + " " + body);
        }
        JSONObject json = new JSONObject(body);
        String jobId = json.optJSONObject("data") != null ? json.getJSONObject("data").optString("jobId", "") : "";
        if (jobId.isEmpty()) {
            throw new Exception("OCR 提交失败：没有返回 jobId。");
        }
        return jobId;
    }

    private String pollJob(String jobId) throws Exception {
        long startedAt = System.currentTimeMillis();
        while (System.currentTimeMillis() - startedAt < MAX_WAIT_MS) {
            Thread.sleep(POLL_INTERVAL_MS);
            HttpURLConnection connection = openConnection(JOB_URL + "/" + jobId, "GET");
            connection.setRequestProperty("Authorization", "bearer " + TOKEN);
            String body = readResponse(connection);
            if (connection.getResponseCode() != 200) {
                throw new Exception("OCR 查询失败：" + connection.getResponseCode() + " " + body);
            }
            JSONObject data = new JSONObject(body).optJSONObject("data");
            if (data == null) {
                throw new Exception("OCR 查询失败：返回数据为空。");
            }
            String state = data.optString("state", "");
            if ("failed".equals(state)) {
                throw new Exception(data.optString("errorMsg", "OCR 识别失败。"));
            }
            if (!"done".equals(state)) {
                continue;
            }
            JSONObject resultUrl = data.optJSONObject("resultUrl");
            String jsonUrl = resultUrl != null ? resultUrl.optString("jsonUrl", "") : "";
            if (jsonUrl.isEmpty()) {
                throw new Exception("OCR 已完成，但没有返回结果地址。");
            }
            return jsonUrl;
        }
        throw new Exception("OCR 识别超时，请稍后重试。");
    }

    private HttpURLConnection openConnection(String url, String method) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(30000);
        connection.setReadTimeout(30000);
        return connection;
    }

    private void writeFormField(OutputStream output, String boundary, String name, String value) throws Exception {
        output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(("Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        output.write((value + "\r\n").getBytes(StandardCharsets.UTF_8));
    }

    private void writeFileField(
        OutputStream output,
        String boundary,
        String name,
        String fileName,
        String mimeType,
        byte[] bytes
    ) throws Exception {
        output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(
            (
                "Content-Disposition: form-data; name=\"" +
                name +
                "\"; filename=\"" +
                fileName.replace("\"", "_") +
                "\"\r\n"
            ).getBytes(StandardCharsets.UTF_8)
        );
        output.write(("Content-Type: " + mimeType + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(bytes);
        output.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }

    private String readUrl(String url) throws Exception {
        HttpURLConnection connection = openConnection(url, "GET");
        String body = readResponse(connection);
        if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) {
            throw new Exception("OCR 结果下载失败：" + connection.getResponseCode());
        }
        return body;
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
            return builder.toString();
        }
    }

    private String extractText(String jsonl) throws Exception {
        StringBuilder builder = new StringBuilder();
        for (String line : jsonl.split("\\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            JSONObject parsed = new JSONObject(trimmed);
            appendKnownText(builder, parsed);
        }
        return builder.toString().trim();
    }

    private void appendKnownText(StringBuilder builder, Object value) throws Exception {
        if (value == null) {
            return;
        }
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int index = 0; index < array.length(); index += 1) {
                Object item = array.opt(index);
                if (item instanceof String) {
                    appendChunk(builder, (String) item);
                } else {
                    appendKnownText(builder, item);
                }
            }
            return;
        }
        if (!(value instanceof JSONObject)) {
            return;
        }

        JSONObject object = (JSONObject) value;
        JSONObject markdown = object.optJSONObject("markdown");
        if (markdown != null) {
            appendChunk(builder, markdown.optString("text", ""));
        }
        appendChunk(builder, object.optString("text", ""));
        appendChunk(builder, object.optString("recText", ""));
        appendChunk(builder, object.optString("rec_text", ""));

        JSONArray recTexts = object.optJSONArray("recTexts");
        if (recTexts == null) {
            recTexts = object.optJSONArray("rec_texts");
        }
        if (recTexts != null) {
            for (int index = 0; index < recTexts.length(); index += 1) {
                appendChunk(builder, recTexts.optString(index, ""));
            }
        }

        JSONArray layoutResults = object.optJSONArray("layoutParsingResults");
        if (layoutResults != null) {
            appendKnownText(builder, layoutResults);
        }

        Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object child = object.opt(key);
            if (child instanceof JSONObject || child instanceof JSONArray) {
                appendKnownText(builder, child);
            }
        }
    }

    private void appendChunk(StringBuilder builder, String text) {
        String trimmed = text != null ? text.trim() : "";
        if (trimmed.isEmpty() || builder.toString().contains(trimmed)) {
            return;
        }
        if (builder.length() > 0) {
            builder.append("\n\n");
        }
        builder.append(trimmed);
    }
}
