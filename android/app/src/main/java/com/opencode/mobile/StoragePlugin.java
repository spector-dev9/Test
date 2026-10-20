package com.opencode.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

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
