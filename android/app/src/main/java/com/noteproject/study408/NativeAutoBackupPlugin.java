package com.noteproject.study408;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@CapacitorPlugin(name = "NativeAutoBackup")
public class NativeAutoBackupPlugin extends Plugin {
    private static final String PREFS = "native_auto_backup";
    private static final String KEY_TREE_URI = "tree_uri";
    private static final String KEY_FOLDER_NAME = "folder_name";
    private static final String LATEST_FILE_NAME = "study-journal-latest.zip";
    private final Map<String, WriteSession> writeSessions = new ConcurrentHashMap<>();
    private final Map<String, ZipWriteSession> zipWriteSessions = new ConcurrentHashMap<>();

    private static class WriteSession {
        final Uri uri;
        final OutputStream output;
        long size;

        WriteSession(Uri uri, OutputStream output) {
            this.uri = uri;
            this.output = output;
            this.size = 0;
        }
    }

    private static class CountingOutputStream extends OutputStream {
        final OutputStream output;
        long size;

        CountingOutputStream(OutputStream output) {
            this.output = output;
            this.size = 0;
        }

        @Override
        public void write(int b) throws IOException {
            output.write(b);
            size += 1;
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            output.write(b, off, len);
            size += len;
        }

        @Override
        public void flush() throws IOException {
            output.flush();
        }

        @Override
        public void close() throws IOException {
            output.close();
        }
    }

    private static class ZipWriteSession {
        final Uri uri;
        final CountingOutputStream output;
        final ZipOutputStream zip;

        ZipWriteSession(Uri uri, CountingOutputStream output, ZipOutputStream zip) {
            this.uri = uri;
            this.output = output;
            this.zip = zip;
        }
    }

    @PluginMethod
    public void bindFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("未选择备份文件夹。");
            return;
        }

        Uri treeUri = result.getData().getData();
        int flags = result.getData().getFlags() &
            (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        getContext().getContentResolver().takePersistableUriPermission(treeUri, flags);

        String folderName = displayName(treeUri);
        prefs().edit()
            .putString(KEY_TREE_URI, treeUri.toString())
            .putString(KEY_FOLDER_NAME, folderName)
            .apply();

        JSObject response = new JSObject();
        response.put("folderName", folderName);
        call.resolve(response);
    }

    @PluginMethod
    public void isBound(PluginCall call) {
        String treeUri = prefs().getString(KEY_TREE_URI, null);
        JSObject response = new JSObject();
        response.put("bound", treeUri != null);
        response.put("folderName", prefs().getString(KEY_FOLDER_NAME, null));
        call.resolve(response);
    }

    @PluginMethod
    public void writeLatest(PluginCall call) {
        String data = call.getString("data");
        String mimeType = call.getString("mimeType", "application/zip");
        String treeUriText = prefs().getString(KEY_TREE_URI, null);
        if (treeUriText == null) {
            call.reject("尚未绑定自动备份文件夹。");
            return;
        }
        if (data == null || data.isEmpty()) {
            call.reject("备份数据为空。");
            return;
        }

        execute(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                Uri treeUri = Uri.parse(treeUriText);
                Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
                );
                Uri fileUri = findOrCreateFile(documentUri, mimeType);
                try (OutputStream output = getContext().getContentResolver().openOutputStream(fileUri, "wt")) {
                    if (output == null) {
                        throw new IllegalStateException("无法打开备份文件写入流。");
                    }
                    output.write(bytes);
                }

                JSObject response = new JSObject();
                response.put("folderName", prefs().getString(KEY_FOLDER_NAME, null));
                response.put("size", bytes.length);
                response.put("uri", fileUri.toString());
                call.resolve(response);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "写入自动备份失败。", error);
            }
        });
    }

    @PluginMethod
    public void beginWriteLatest(PluginCall call) {
        String mimeType = call.getString("mimeType", "application/zip");
        String treeUriText = prefs().getString(KEY_TREE_URI, null);
        if (treeUriText == null) {
            call.reject("尚未绑定自动备份文件夹。");
            return;
        }

        execute(() -> {
            try {
                Uri treeUri = Uri.parse(treeUriText);
                Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
                );
                Uri fileUri = findOrCreateFile(documentUri, mimeType);
                OutputStream output = getContext().getContentResolver().openOutputStream(fileUri, "wt");
                if (output == null) {
                    throw new IllegalStateException("无法打开备份文件写入流。");
                }

                String sessionId = UUID.randomUUID().toString();
                writeSessions.put(sessionId, new WriteSession(fileUri, output));

                JSObject response = new JSObject();
                response.put("sessionId", sessionId);
                response.put("folderName", prefs().getString(KEY_FOLDER_NAME, null));
                response.put("uri", fileUri.toString());
                call.resolve(response);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "开始自动备份写入失败。", error);
            }
        });
    }

    @PluginMethod
    public void appendWriteLatest(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String data = call.getString("data");
        if (sessionId == null || sessionId.isEmpty()) {
            call.reject("缺少自动备份写入会话。");
            return;
        }
        if (data == null) {
            call.reject("备份数据为空。");
            return;
        }

        WriteSession session = writeSessions.get(sessionId);
        if (session == null) {
            call.reject("自动备份写入会话已失效。");
            return;
        }

        execute(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                session.output.write(bytes);
                session.size += bytes.length;

                JSObject response = new JSObject();
                response.put("size", session.size);
                call.resolve(response);
            } catch (Exception error) {
                writeSessions.remove(sessionId);
                closeQuietly(session.output);
                call.reject(error.getMessage() != null ? error.getMessage() : "写入自动备份分块失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishWriteLatest(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            call.reject("缺少自动备份写入会话。");
            return;
        }

        WriteSession session = writeSessions.remove(sessionId);
        if (session == null) {
            call.reject("自动备份写入会话已失效。");
            return;
        }

        execute(() -> {
            try {
                session.output.flush();
                session.output.close();

                JSObject response = new JSObject();
                response.put("folderName", prefs().getString(KEY_FOLDER_NAME, null));
                response.put("size", session.size);
                response.put("uri", session.uri.toString());
                call.resolve(response);
            } catch (Exception error) {
                closeQuietly(session.output);
                call.reject(error.getMessage() != null ? error.getMessage() : "完成自动备份写入失败。", error);
            }
        });
    }

    @PluginMethod
    public void cancelWriteLatest(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            call.resolve();
            return;
        }

        WriteSession session = writeSessions.remove(sessionId);
        if (session == null) {
            call.resolve();
            return;
        }

        execute(() -> {
            closeQuietly(session.output);
            call.resolve();
        });
    }

    @PluginMethod
    public void beginZipLatest(PluginCall call) {
        String mimeType = call.getString("mimeType", "application/zip");
        String fileName = safeFileName(call.getString("fileName", LATEST_FILE_NAME));
        String treeUriText = prefs().getString(KEY_TREE_URI, null);
        if (treeUriText == null) {
            call.reject("尚未绑定自动备份文件夹。");
            return;
        }

        execute(() -> {
            try {
                Uri treeUri = Uri.parse(treeUriText);
                Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
                );
                Uri fileUri = findOrCreateFile(documentUri, mimeType, fileName);
                OutputStream rawOutput = getContext().getContentResolver().openOutputStream(fileUri, "wt");
                if (rawOutput == null) {
                    throw new IllegalStateException("无法打开自动备份 zip 写入流。");
                }
                CountingOutputStream countedOutput = new CountingOutputStream(rawOutput);
                ZipOutputStream zip = new ZipOutputStream(countedOutput);
                zip.setLevel(Deflater.NO_COMPRESSION);

                String sessionId = UUID.randomUUID().toString();
                zipWriteSessions.put(sessionId, new ZipWriteSession(fileUri, countedOutput, zip));

                JSObject response = new JSObject();
                response.put("sessionId", sessionId);
                response.put("folderName", prefs().getString(KEY_FOLDER_NAME, null));
                response.put("uri", fileUri.toString());
                call.resolve(response);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "开始自动备份 zip 写入失败。", error);
            }
        });
    }

    @PluginMethod
    public void beginZipEntry(PluginCall call) {
        ZipWriteSession session = zipWriteSession(call);
        if (session == null) {
            return;
        }
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("缺少自动备份 zip entry 路径。");
            return;
        }

        execute(() -> {
            try {
                session.zip.putNextEntry(new ZipEntry(path));
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "开始写入自动备份 zip entry 失败。", error);
            }
        });
    }

    @PluginMethod
    public void appendZipEntry(PluginCall call) {
        ZipWriteSession session = zipWriteSession(call);
        if (session == null) {
            return;
        }
        String data = call.getString("data");
        if (data == null) {
            call.reject("自动备份 zip entry 数据为空。");
            return;
        }

        execute(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                session.zip.write(bytes);
                call.resolve();
            } catch (Exception error) {
                zipWriteSessions.remove(call.getString("sessionId"));
                closeQuietly(session.zip);
                call.reject(error.getMessage() != null ? error.getMessage() : "写入自动备份 zip entry 分块失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishZipEntry(PluginCall call) {
        ZipWriteSession session = zipWriteSession(call);
        if (session == null) {
            return;
        }

        execute(() -> {
            try {
                session.zip.closeEntry();
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "完成自动备份 zip entry 失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishZipLatest(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            call.reject("缺少自动备份 zip 写入会话。");
            return;
        }

        ZipWriteSession session = zipWriteSessions.remove(sessionId);
        if (session == null) {
            call.reject("自动备份 zip 写入会话已失效。");
            return;
        }

        execute(() -> {
            try {
                session.zip.finish();
                session.zip.close();
                if (session.output.size <= 0) {
                    throw new IllegalStateException("自动备份写入结果为空。");
                }

                JSObject response = new JSObject();
                response.put("folderName", prefs().getString(KEY_FOLDER_NAME, null));
                response.put("size", session.output.size);
                response.put("uri", session.uri.toString());
                call.resolve(response);
            } catch (Exception error) {
                closeQuietly(session.zip);
                call.reject(error.getMessage() != null ? error.getMessage() : "完成自动备份 zip 写入失败。", error);
            }
        });
    }

    @PluginMethod
    public void cancelZipLatest(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            call.resolve();
            return;
        }

        ZipWriteSession session = zipWriteSessions.remove(sessionId);
        if (session == null) {
            call.resolve();
            return;
        }

        execute(() -> {
            closeQuietly(session.zip);
            call.resolve();
        });
    }

    private ZipWriteSession zipWriteSession(PluginCall call) {
        String sessionId = call.getString("sessionId");
        ZipWriteSession session = zipWriteSessions.get(sessionId);
        if (session == null) {
            call.reject("自动备份 zip 写入会话已失效。");
        }
        return session;
    }

    private Uri findOrCreateFile(Uri documentUri, String mimeType) throws Exception {
        return findOrCreateFile(documentUri, mimeType, LATEST_FILE_NAME);
    }

    private Uri findOrCreateFile(Uri documentUri, String mimeType, String fileName) throws Exception {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            documentUri,
            DocumentsContract.getDocumentId(documentUri)
        );
        try (android.database.Cursor cursor = getContext().getContentResolver().query(
            childrenUri,
            new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME
            },
            null,
            null,
            null
        )) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String documentId = cursor.getString(0);
                    String name = cursor.getString(1);
                    if (fileName.equals(name)) {
                        return DocumentsContract.buildDocumentUriUsingTree(documentUri, documentId);
                    }
                }
            }
        }
        Uri created = DocumentsContract.createDocument(
            getContext().getContentResolver(),
            documentUri,
            mimeType,
            fileName
        );
        if (created == null) {
            throw new IllegalStateException("无法创建自动备份文件。");
        }
        return created;
    }

    private void closeQuietly(OutputStream output) {
        try {
            output.close();
        } catch (Exception ignored) {
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
    }

    private String displayName(Uri uri) {
        String path = uri.getLastPathSegment();
        if (path == null || path.isEmpty()) {
            return "已绑定文件夹";
        }
        int colon = path.lastIndexOf(':');
        String name = colon >= 0 ? path.substring(colon + 1) : path;
        return name.isEmpty() ? "已绑定文件夹" : name;
    }

    private String safeFileName(String name) {
        if (name == null || name.isEmpty()) {
            return LATEST_FILE_NAME;
        }
        return name.replaceAll("[\\\\/:*?\"<>|]+", "_");
    }
}
