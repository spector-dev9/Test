package com.opencode.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.IOException;

@CapacitorPlugin(
    name = "Storage",
    permissions = {
        @Permission(
            alias = "storage",
            strings = {
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            }
        )
    }
)
public class StoragePlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (hasStorageAccess()) {
            call.resolve(statusObject());
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }

        Intent intent = new Intent(
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName())
        );

        try {
            startActivityForResult(call, intent, "manageStorageCallback");
        } catch (ActivityNotFoundException primaryFailure) {
            Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
            try {
                startActivityForResult(call, fallback, "manageStorageCallback");
            } catch (ActivityNotFoundException fallbackFailure) {
                call.reject("Device settings do not expose all-files access.");
            }
        }
    }

    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );

        try {
            startActivityForResult(call, intent, "pickDirectoryCallback");
        } catch (ActivityNotFoundException failure) {
            call.reject("No folder picker is available on this device.");
        }
    }

    @ActivityCallback
    private void manageStorageCallback(PluginCall call, ActivityResult result) {
        if (call == null) return;
        call.resolve(statusObject());
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (call == null) return;
        call.resolve(statusObject());
    }

    @ActivityCallback
    private void pickDirectoryCallback(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri treeUri = result.getData().getData();
        if (treeUri == null) {
            call.reject("The folder picker returned no folder.");
            return;
        }

        try {
            getContext().getContentResolver().takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION |
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (SecurityException ignored) {
            // Read access may still be usable even if persistable grants are refused.
        }

        String path = pathForTreeUri(treeUri);
        if (path == null) {
            call.reject(
                "This provider does not expose a filesystem path. Choose a folder on internal storage or an SD card."
            );
            return;
        }

        File directory = new File(path);
        if (!directory.isDirectory()) {
            call.reject("The selected folder is not accessible.");
            return;
        }

        JSObject selection = new JSObject();
        selection.put("cancelled", false);
        selection.put("path", path);
        selection.put("name", directory.getName().isEmpty() ? path : directory.getName());
        selection.put("uri", treeUri.toString());
        call.resolve(selection);
    }

    @PluginMethod
    public void pickDocument(PluginCall call) {
        String[] mimeTypes = mimeTypesFrom(call.getArray("mimeTypes"));
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        try {
            startActivityForResult(call, intent, "pickDocumentCallback");
        } catch (ActivityNotFoundException failure) {
            call.reject("No file picker is available on this device.");
        }
    }

    @PluginMethod
    public void createDocument(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.trim().isEmpty()) {
            name = "session.json";
        }
        String mime = call.getString("mime");
        if (mime == null || mime.trim().isEmpty()) {
            mime = "application/json";
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        );

        try {
            startActivityForResult(call, intent, "createDocumentCallback");
        } catch (ActivityNotFoundException failure) {
            call.reject("No file saver is available on this device.");
        }
    }

    @ActivityCallback
    private void pickDocumentCallback(PluginCall call, ActivityResult result) {
        resolveDocument(call, result, false);
    }

    @ActivityCallback
    private void createDocumentCallback(PluginCall call, ActivityResult result) {
        resolveDocument(call, result, true);
    }

    private void resolveDocument(PluginCall call, ActivityResult result, boolean write) {
        if (call == null) return;

        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        JSObject document = new JSObject();
        document.put("cancelled", false);
        document.put("uri", uri.toString());
        String name = displayName(uri);
        if (name != null && !name.trim().isEmpty()) {
            document.put("name", name);
        } else if (write) {
            document.put("name", "session.json");
        }
        if (!write) {
            document.put("size", Math.max(0L, displaySize(uri)));
        }
        call.resolve(document);
    }

    private String[] mimeTypesFrom(JSArray requested) {
        String[] fallback = { "application/json", "text/json", "*/*" };
        if (requested == null || requested.length() == 0) return fallback;

        try {
            if (requested.length() == 1) {
                String only = requested.getString(0);
                if (only != null && !only.trim().isEmpty()) return new String[] { only };
            }
            java.util.List<String> values = new java.util.ArrayList<>();
            for (int index = 0; index < requested.length(); index++) {
                String value = requested.getString(index);
                if (value != null && !value.trim().isEmpty() && !values.contains(value)) {
                    values.add(value);
                }
            }
            if (!values.isEmpty()) return values.toArray(new String[0]);
        } catch (Exception ignored) {
            // Fall through to the default JSON filter.
        }
        return fallback;
    }

    private String displayName(Uri uri) {
        try (
            Cursor cursor = getContext().getContentResolver().query(
                uri,
                new String[] { OpenableColumns.DISPLAY_NAME },
                null,
                null,
                null
            )
        ) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {
            // Display name is optional.
        }
        return null;
    }

    private long displaySize(Uri uri) {
        try (
            Cursor cursor = getContext().getContentResolver().query(
                uri,
                new String[] { OpenableColumns.SIZE },
                null,
                null,
                null
            )
        ) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0 && !cursor.isNull(index)) return cursor.getLong(index);
            }
        } catch (Exception ignored) {
        }
        return 0;
    }

    private JSObject statusObject() {
        JSObject status = new JSObject();
        status.put("allFiles", hasStorageAccess());
        status.put("sdk", Build.VERSION.SDK_INT);
        return status;
    }

    private boolean hasStorageAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }

        return getContext().checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED &&
            getContext().checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }

    private String pathForTreeUri(Uri treeUri) {
        String documentId;

        try {
            documentId = DocumentsContract.getTreeDocumentId(treeUri);
        } catch (IllegalArgumentException failure) {
            return null;
        }

        if (documentId == null || !documentId.contains(":")) return null;

        String[] parts = documentId.split(":", 2);
        String volume = parts[0];
        String relative = parts.length > 1 ? parts[1] : "";
        File root;

        if ("primary".equalsIgnoreCase(volume)) {
            root = Environment.getExternalStorageDirectory();
        } else if ("home".equalsIgnoreCase(volume)) {
            root = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOCUMENTS
            );
        } else if ("raw".equalsIgnoreCase(volume)) {
            if (!relative.startsWith("/")) return null;
            root = new File("/");
            relative = relative.substring(1);
        } else {
            root = new File("/storage", volume);
        }

        if (relative.contains("..")) return null;

        try {
            File rootFile = root.getCanonicalFile();
            File target = relative.isEmpty()
                ? rootFile
                : new File(rootFile, relative).getCanonicalFile();
            String rootPath = rootFile.getAbsolutePath();
            String targetPath = target.getAbsolutePath();

            if (
                !targetPath.equals(rootPath) &&
                !targetPath.startsWith(rootPath + File.separator)
            ) {
                return null;
            }

            return targetPath;
        } catch (IOException failure) {
            return null;
        }
    }
}
