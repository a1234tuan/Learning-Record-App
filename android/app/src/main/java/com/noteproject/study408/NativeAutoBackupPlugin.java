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
import java.io.OutputStream;

@CapacitorPlugin(name = "NativeAutoBackup")
public class NativeAutoBackupPlugin extends Plugin {
    private static final String PREFS = "native_auto_backup";
    private static final String KEY_TREE_URI = "tree_uri";
    private static final String KEY_FOLDER_NAME = "folder_name";
    private static final String LATEST_FILE_NAME = "study-journal-latest.zip";

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

    private Uri findOrCreateFile(Uri documentUri, String mimeType) throws Exception {
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
                    if (LATEST_FILE_NAME.equals(name)) {
                        return DocumentsContract.buildDocumentUriUsingTree(documentUri, documentId);
                    }
                }
            }
        }
        Uri created = DocumentsContract.createDocument(
            getContext().getContentResolver(),
            documentUri,
            mimeType,
            LATEST_FILE_NAME
        );
        if (created == null) {
            throw new IllegalStateException("无法创建自动备份文件。");
        }
        return created;
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
}
