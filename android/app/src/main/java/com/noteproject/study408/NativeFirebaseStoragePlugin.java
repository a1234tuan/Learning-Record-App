package com.noteproject.study408;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
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
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Firebase's JavaScript Storage client runs inside Android WebView. Some VPN/proxy setups can
 * reach Firebase in Chrome but repeatedly fail from that WebView. This bridge performs
 * authenticated Storage REST operations through Android's normal network stack instead.
 */
@CapacitorPlugin(name = "NativeFirebaseStorage")
public class NativeFirebaseStoragePlugin extends Plugin {
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int EXISTS_READ_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 300_000;
    // Matches android/app/google-services.json. The bucket name is public client configuration,
    // while access remains protected by the Firebase ID token passed with each request.
    private static final String STORAGE_BUCKET = "study-journal-408-9f31.firebasestorage.app";
    private final Map<String, DownloadSession> downloadSessions = new ConcurrentHashMap<>();
    private final Map<String, UploadSession> uploadSessions = new ConcurrentHashMap<>();

    private static class DownloadSession {
        final File file;
        final String contentType;

        DownloadSession(File file, String contentType) {
            this.file = file;
            this.contentType = contentType;
        }
    }

    private static class UploadSession {
        final File file;
        final FileOutputStream output;
        final String path;
        final String idToken;
        final String contentType;

        UploadSession(File file, FileOutputStream output, String path, String idToken, String contentType) {
            this.file = file;
            this.output = output;
            this.path = path;
            this.idToken = idToken;
            this.contentType = contentType;
        }
    }

    @PluginMethod
    public void exists(PluginCall call) {
        String path = call.getString("path", "");
        String idToken = call.getString("idToken", "");
        if (path.trim().isEmpty() || idToken.trim().isEmpty()) {
            call.reject("原生 Firebase Storage 检查缺少资源路径或登录令牌。");
            return;
        }
        execute(() -> {
            HttpURLConnection connection = null;
            try {
                String encodedPath = URLEncoder.encode(path, StandardCharsets.UTF_8).replace("+", "%20");
                URL url = new URL("https://firebasestorage.googleapis.com/v0/b/" + STORAGE_BUCKET + "/o/" + encodedPath);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(EXISTS_READ_TIMEOUT_MS);
                connection.setRequestProperty("Authorization", "Firebase " + idToken);
                connection.setRequestProperty("Accept", "application/json");
                int status = connection.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_NOT_FOUND) {
                    throw new IllegalStateException("Firebase Storage 原生检查失败（HTTP " + status + "）：" + compact(readBody(connection.getErrorStream())));
                }
                JSObject result = new JSObject();
                result.put("exists", status == HttpURLConnection.HTTP_OK);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "Firebase Storage 原生检查失败。", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    /** List a Storage prefix in one request (paginated by Firebase at 1,000 objects per page). */
    @PluginMethod
    public void list(PluginCall call) {
        String prefix = call.getString("prefix", "");
        String idToken = call.getString("idToken", "");
        if (prefix.trim().isEmpty() || idToken.trim().isEmpty()) {
            call.reject("原生 Firebase Storage 列表缺少前缀或登录令牌。");
            return;
        }
        execute(() -> {
            try {
                Set<String> paths = new LinkedHashSet<>();
                String pageToken = null;
                do {
                    HttpURLConnection connection = null;
                    try {
                        StringBuilder urlText = new StringBuilder("https://firebasestorage.googleapis.com/v0/b/")
                                .append(STORAGE_BUCKET)
                                .append("/o?prefix=")
                                .append(URLEncoder.encode(prefix, StandardCharsets.UTF_8).replace("+", "%20"))
                                .append("&maxResults=1000");
                        if (pageToken != null && !pageToken.isEmpty()) {
                            urlText.append("&pageToken=")
                                    .append(URLEncoder.encode(pageToken, StandardCharsets.UTF_8).replace("+", "%20"));
                        }
                        connection = (HttpURLConnection) new URL(urlText.toString()).openConnection();
                        connection.setRequestMethod("GET");
                        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                        connection.setReadTimeout(EXISTS_READ_TIMEOUT_MS);
                        connection.setRequestProperty("Authorization", "Firebase " + idToken);
                        connection.setRequestProperty("Accept", "application/json");
                        int status = connection.getResponseCode();
                        if (status != HttpURLConnection.HTTP_OK) {
                            throw new IllegalStateException("Firebase Storage 原生列表失败（HTTP " + status + "）：" + compact(readBody(connection.getErrorStream())));
                        }
                        JSONObject response = new JSONObject(readBody(connection.getInputStream()));
                        JSONArray items = response.optJSONArray("items");
                        if (items != null) {
                            for (int index = 0; index < items.length(); index += 1) {
                                String name = items.optJSONObject(index) != null
                                        ? items.optJSONObject(index).optString("name", "")
                                        : "";
                                if (!name.isEmpty()) paths.add(name);
                            }
                        }
                        pageToken = response.optString("nextPageToken", "");
                    } finally {
                        if (connection != null) connection.disconnect();
                    }
                } while (pageToken != null && !pageToken.isEmpty());

                JSArray resultPaths = new JSArray();
                for (String path : paths) resultPaths.put(path);
                JSObject result = new JSObject();
                result.put("paths", resultPaths);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "Firebase Storage 原生列表失败。", error);
            }
        });
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
                connection.setRequestProperty("Authorization", "Firebase " + idToken);
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

    @PluginMethod
    public void beginUpload(PluginCall call) {
        String path = call.getString("path", "");
        String idToken = call.getString("idToken", "");
        String contentType = call.getString("contentType", "application/octet-stream");
        if (path.trim().isEmpty() || idToken.trim().isEmpty()) {
            call.reject("原生 Firebase Storage 上传缺少资源路径或登录令牌。");
            return;
        }
        execute(() -> {
            try {
                File directory = new File(getContext().getCacheDir(), "firebase-storage-uploads");
                if (!directory.exists() && !directory.mkdirs()) {
                    throw new IllegalStateException("无法创建 Firebase Storage 上传缓存目录。");
                }
                File file = new File(directory, UUID.randomUUID() + ".bin");
                String sessionId = UUID.randomUUID().toString();
                uploadSessions.put(sessionId, new UploadSession(file, new FileOutputStream(file), path, idToken, contentType));
                JSObject result = new JSObject();
                result.put("sessionId", sessionId);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "开始 Firebase Storage 上传失败。", error);
            }
        });
    }

    @PluginMethod
    public void appendUploadChunk(PluginCall call) {
        UploadSession session = uploadSession(call);
        if (session == null) return;
        String base64 = call.getString("base64");
        if (base64 == null) {
            call.reject("Firebase Storage 上传分块为空。");
            return;
        }
        execute(() -> {
            try {
                session.output.write(Base64.decode(base64, Base64.DEFAULT));
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "写入 Firebase Storage 上传分块失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishUpload(PluginCall call) {
        String sessionId = call.getString("sessionId", "");
        UploadSession session = uploadSessions.remove(sessionId);
        if (session == null) {
            call.reject("Firebase Storage 上传会话已失效。");
            return;
        }
        execute(() -> {
            HttpURLConnection connection = null;
            try {
                session.output.close();
                String encodedPath = URLEncoder.encode(session.path, StandardCharsets.UTF_8).replace("+", "%20");
                URL url = new URL("https://firebasestorage.googleapis.com/v0/b/" + STORAGE_BUCKET + "/o?uploadType=media&name=" + encodedPath);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(session.file.length());
                connection.setRequestProperty("Authorization", "Firebase " + session.idToken);
                connection.setRequestProperty("Content-Type", session.contentType);
                try (InputStream input = new java.io.FileInputStream(session.file); java.io.OutputStream output = connection.getOutputStream()) {
                    byte[] buffer = new byte[32 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    throw new IllegalStateException("Firebase Storage 原生上传失败（HTTP " + status + "）：" + compact(readBody(connection.getErrorStream())));
                }
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "Firebase Storage 原生上传失败。", error);
            } finally {
                if (connection != null) connection.disconnect();
                session.file.delete();
            }
        });
    }

    @PluginMethod
    public void cancelUpload(PluginCall call) {
        UploadSession session = uploadSessions.remove(call.getString("sessionId", ""));
        if (session != null) {
            try {
                session.output.close();
            } catch (Exception ignored) {
            }
            session.file.delete();
        }
        call.resolve();
    }

    private UploadSession uploadSession(PluginCall call) {
        UploadSession session = uploadSessions.get(call.getString("sessionId", ""));
        if (session == null) call.reject("Firebase Storage 上传会话已失效。");
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
