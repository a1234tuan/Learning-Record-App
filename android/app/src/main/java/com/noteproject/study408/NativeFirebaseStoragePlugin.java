package com.noteproject.study408;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Firebase's JavaScript Storage client runs inside Android WebView. Some VPN/proxy setups can
 * reach Firebase in Chrome but repeatedly fail from that WebView. This small bridge performs the
 * authenticated Storage REST download through Android's normal network stack instead.
 */
@CapacitorPlugin(name = "NativeFirebaseStorage")
public class NativeFirebaseStoragePlugin extends Plugin {
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 300_000;
    // Matches android/app/google-services.json. The bucket name is public client configuration,
    // while access remains protected by the Firebase ID token passed with each request.
    private static final String STORAGE_BUCKET = "study-journal-408-9f31.firebasestorage.app";
    private final Map<String, DownloadSession> downloadSessions = new ConcurrentHashMap<>();

    private static class DownloadSession {
        final File file;
        final String contentType;

        DownloadSession(File file, String contentType) {
            this.file = file;
            this.contentType = contentType;
        }
    }

    @PluginMethod
    public void beginDownload(PluginCall call) {
        String path = call.getString("path", "");
        String idToken = call.getString("idToken", "");
        if (path.trim().isEmpty() || idToken.trim().isEmpty()) {
            call.reject("原生 Firebase Storage 下载缺少资源路径或登录令牌。");
            return;
        }

        execute(() -> {
            HttpURLConnection connection = null;
            try {
                String encodedPath = URLEncoder.encode(path, StandardCharsets.UTF_8).replace("+", "%20");
                URL url = new URL("https://firebasestorage.googleapis.com/v0/b/" + STORAGE_BUCKET + "/o/" + encodedPath + "?alt=media");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setRequestProperty("Authorization", "Bearer " + idToken);
                connection.setRequestProperty("Accept", "application/octet-stream");

                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    String detail = readBody(connection.getErrorStream());
                    throw new IllegalStateException("Firebase Storage 原生下载失败（HTTP " + status + "）：" + compact(detail));
                }
                File directory = new File(getContext().getCacheDir(), "firebase-storage-downloads");
                if (!directory.exists() && !directory.mkdirs()) {
                    throw new IllegalStateException("无法创建 Firebase Storage 下载缓存目录。");
                }
                File file = new File(directory, UUID.randomUUID() + ".bin");
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(file)) {
                    byte[] buffer = new byte[32 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                String sessionId = UUID.randomUUID().toString();
                downloadSessions.put(sessionId, new DownloadSession(file, connection.getContentType()));
                JSObject result = new JSObject();
                result.put("sessionId", sessionId);
                result.put("size", file.length());
                String contentType = connection.getContentType();
                if (contentType != null && !contentType.trim().isEmpty()) result.put("contentType", contentType);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "原生 Firebase Storage 下载失败。", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void readDownloadChunk(PluginCall call) {
        DownloadSession session = downloadSession(call);
        if (session == null) return;
        long offset = call.getLong("offset", 0L);
        int length = Math.min(Math.max(call.getInt("length", 512 * 1024), 1), 768 * 1024);
        execute(() -> {
            try (RandomAccessFile input = new RandomAccessFile(session.file, "r")) {
                if (offset < 0 || offset > input.length()) throw new IllegalArgumentException("下载分块偏移量无效。");
                input.seek(offset);
                int bytesToRead = (int) Math.min(length, input.length() - offset);
                byte[] buffer = new byte[bytesToRead];
                int bytesRead = bytesToRead == 0 ? 0 : input.read(buffer);
                if (bytesRead < 0) bytesRead = 0;
                JSObject result = new JSObject();
                result.put("base64", Base64.encodeToString(bytesRead == buffer.length ? buffer : java.util.Arrays.copyOf(buffer, bytesRead), Base64.NO_WRAP));
                result.put("bytesRead", bytesRead);
                result.put("done", offset + bytesRead >= input.length());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "读取 Firebase Storage 下载分块失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishDownload(PluginCall call) {
        String sessionId = call.getString("sessionId", "");
        DownloadSession session = downloadSessions.remove(sessionId);
        if (session != null) session.file.delete();
        call.resolve();
    }

    private DownloadSession downloadSession(PluginCall call) {
        DownloadSession session = downloadSessions.get(call.getString("sessionId", ""));
        if (session == null) call.reject("Firebase Storage 下载会话已失效。");
        return session;
    }

    private byte[] readBytes(InputStream input) throws Exception {
        if (input == null) return new byte[0];
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }

    private String readBody(InputStream input) throws Exception {
        return new String(readBytes(input), StandardCharsets.UTF_8);
    }

    private String compact(String value) {
        if (value == null || value.trim().isEmpty()) return "响应体为空。";
        String normalized = value.replaceAll("\\s+", " ").trim();
        return normalized.length() > 300 ? normalized.substring(0, 300) + "..." : normalized;
    }
}
