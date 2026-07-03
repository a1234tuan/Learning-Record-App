package com.noteproject.study408;

import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

@CapacitorPlugin(name = "NativeZipArchive")
public class NativeZipArchivePlugin extends Plugin {
    private final Map<String, ExportSession> exportSessions = new ConcurrentHashMap<>();
    private final Map<String, ImportSession> importSessions = new ConcurrentHashMap<>();

    private static class ExportSession {
        final File file;
        final ZipOutputStream zip;
        final String uri;
        long size;

        ExportSession(File file, ZipOutputStream zip, String uri) {
            this.file = file;
            this.zip = zip;
            this.uri = uri;
            this.size = 0;
        }
    }

    private static class ImportSession {
        final File file;
        final ZipFile zip;

        ImportSession(File file, ZipFile zip) {
            this.file = file;
            this.zip = zip;
        }
    }

    @PluginMethod
    public void beginExport(PluginCall call) {
        String fileName = safeName(call.getString("fileName", "study-journal.zip"));
        execute(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "shared-exports");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IllegalStateException("无法创建导出缓存目录。");
                }
                File file = new File(dir, fileName);
                ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(file, false));
                zip.setLevel(Deflater.NO_COMPRESSION);
                String sessionId = UUID.randomUUID().toString();
                exportSessions.put(sessionId, new ExportSession(file, zip, Uri.fromFile(file).toString()));
                JSObject result = new JSObject();
                result.put("sessionId", sessionId);
                result.put("uri", Uri.fromFile(file).toString());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "开始导出 zip 失败。", error);
            }
        });
    }

    @PluginMethod
    public void beginEntry(PluginCall call) {
        ExportSession session = exportSession(call);
        if (session == null) {
            return;
        }
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("缺少 zip entry 路径。");
            return;
        }
        execute(() -> {
            try {
                session.zip.putNextEntry(new ZipEntry(path));
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "开始写入 zip entry 失败。", error);
            }
        });
    }

    @PluginMethod
    public void appendEntry(PluginCall call) {
        ExportSession session = exportSession(call);
        if (session == null) {
            return;
        }
        String data = call.getString("data");
        if (data == null) {
            call.reject("zip entry 数据为空。");
            return;
        }
        execute(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                session.zip.write(bytes);
                session.size += bytes.length;
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "写入 zip entry 分块失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishEntry(PluginCall call) {
        ExportSession session = exportSession(call);
        if (session == null) {
            return;
        }
        execute(() -> {
            try {
                session.zip.closeEntry();
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "完成 zip entry 失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishExport(PluginCall call) {
        String sessionId = call.getString("sessionId");
        ExportSession session = exportSessions.remove(sessionId);
        if (session == null) {
            call.reject("zip 导出会话已失效。");
            return;
        }
        execute(() -> {
            try {
                session.zip.finish();
                session.zip.close();
                JSObject result = new JSObject();
                result.put("uri", session.uri);
                result.put("size", session.file.length());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "完成 zip 导出失败。", error);
            }
        });
    }

    @PluginMethod
    public void cancelExport(PluginCall call) {
        String sessionId = call.getString("sessionId");
        ExportSession session = exportSessions.remove(sessionId);
        if (session != null) {
            try {
                session.zip.close();
            } catch (Exception ignored) {
            }
            session.file.delete();
        }
        call.resolve();
    }

    @PluginMethod
    public void beginImport(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("缺少导入 zip 路径。");
            return;
        }
        execute(() -> {
            try {
                File file = cacheFileForImport(path);
                ZipFile zip = new ZipFile(file);
                String sessionId = UUID.randomUUID().toString();
                importSessions.put(sessionId, new ImportSession(file, zip));
                JSArray entries = new JSArray();
                Enumeration<? extends ZipEntry> names = zip.entries();
                while (names.hasMoreElements()) {
                    ZipEntry entry = names.nextElement();
                    if (!entry.isDirectory()) {
                        entries.put(entry.getName());
                    }
                }
                JSObject result = new JSObject();
                result.put("sessionId", sessionId);
                result.put("entries", entries);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "索引 zip 失败。", error);
            }
        });
    }

    @PluginMethod
    public void readEntry(PluginCall call) {
        ImportSession session = importSession(call);
        if (session == null) {
            return;
        }
        String path = call.getString("path");
        execute(() -> {
            try {
                ZipEntry entry = session.zip.getEntry(path);
                if (entry == null) {
                    throw new IllegalStateException("zip 缺少 " + path);
                }
                JSObject result = new JSObject();
                result.put("data", Base64.encodeToString(readAll(session.zip.getInputStream(entry)), Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "读取 zip entry 失败。", error);
            }
        });
    }

    @PluginMethod
    public void readEntryChunk(PluginCall call) {
        ImportSession session = importSession(call);
        if (session == null) {
            return;
        }
        String path = call.getString("path");
        int offset = call.getInt("offset", 0);
        int length = call.getInt("length", 768 * 1024);
        execute(() -> {
            try {
                ZipEntry entry = session.zip.getEntry(path);
                if (entry == null) {
                    throw new IllegalStateException("zip 缺少 " + path);
                }
                try (InputStream input = session.zip.getInputStream(entry)) {
                    long skipped = input.skip(offset);
                    while (skipped < offset) {
                        long next = input.skip(offset - skipped);
                        if (next <= 0) {
                            break;
                        }
                        skipped += next;
                    }
                    byte[] buffer = input.readNBytes(length);
                    JSObject result = new JSObject();
                    result.put("data", Base64.encodeToString(buffer, Base64.NO_WRAP));
                    result.put("bytesRead", buffer.length);
                    result.put("done", buffer.length < length);
                    call.resolve(result);
                }
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "读取 zip entry 分块失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishImport(PluginCall call) {
        closeImport(call);
    }

    @PluginMethod
    public void cancelImport(PluginCall call) {
        closeImport(call);
    }

    private ExportSession exportSession(PluginCall call) {
        String sessionId = call.getString("sessionId");
        ExportSession session = exportSessions.get(sessionId);
        if (session == null) {
            call.reject("zip 导出会话已失效。");
        }
        return session;
    }

    private ImportSession importSession(PluginCall call) {
        String sessionId = call.getString("sessionId");
        ImportSession session = importSessions.get(sessionId);
        if (session == null) {
            call.reject("zip 导入会话已失效。");
        }
        return session;
    }

    private void closeImport(PluginCall call) {
        String sessionId = call.getString("sessionId");
        ImportSession session = importSessions.remove(sessionId);
        if (session != null) {
            try {
                session.zip.close();
            } catch (Exception ignored) {
            }
        }
        call.resolve();
    }

    private File cacheFileForImport(String path) throws Exception {
        File file = new File(path);
        if (file.exists()) {
            return file;
        }
        Uri uri = Uri.parse(path);
        File copy = new File(getContext().getCacheDir(), "import-" + UUID.randomUUID() + ".zip");
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             FileOutputStream output = new FileOutputStream(copy)) {
            if (input == null) {
                throw new IllegalStateException("无法打开导入 zip。");
            }
            byte[] buffer = new byte[1024 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        }
        return copy;
    }

    private byte[] readAll(InputStream input) throws Exception {
        try (InputStream in = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private String safeName(String name) {
        return name.replaceAll("[\\\\/:*?\"<>|]+", "_");
    }
}
