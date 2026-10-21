package com.opencode.mobile;

import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LocalServer")
public class LocalServerPlugin extends Plugin {

    private LocalServerManager manager;
    private final LocalServerManager.Listener listener = snapshot -> emit(snapshot);

    @Override
    public void load() {
        manager = LocalServerManager.get(getContext());
        manager.addListener(listener);
    }

    @Override
    protected void handleOnDestroy() {
        if (manager != null) manager.removeListener(listener);
        super.handleOnDestroy();
    }

    @PluginMethod
    public void ensureStarted(PluginCall call) {
        manager.ensureStarted(listener, (snapshot, error) ->
            resolve(call, snapshot, error)
        );
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(manager.statusObject());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        manager.stop((snapshot, error) -> resolve(call, snapshot, error));
    }

    @PluginMethod
    public void restart(PluginCall call) {
        manager.restart((snapshot, error) -> resolve(call, snapshot, error));
    }

    @PluginMethod
    public void repair(PluginCall call) {
        manager.repair((snapshot, error) -> resolve(call, snapshot, error));
    }

    @PluginMethod
    public void logs(PluginCall call) {
        call.resolve(new JSObject().put("logs", manager.logs()));
    }

    @PluginMethod
    public void exportSession(PluginCall call) {
        String sessionID = call.getString("sessionID");
        String uri = call.getString("uri");
        if (sessionID == null || sessionID.trim().isEmpty()) {
            call.reject("A session to export is required.");
            return;
        }
        if (uri == null || uri.trim().isEmpty()) {
            call.reject("A destination file is required.");
            return;
        }
        manager.exportSession(sessionID, Uri.parse(uri), (bytes, output, error) ->
            resolveTransfer(call, bytes, output, error)
        );
    }

    @PluginMethod
    public void importSession(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.trim().isEmpty()) {
            call.reject("A session file is required.");
            return;
        }
        manager.importSession(Uri.parse(uri), (bytes, output, error) ->
            resolveTransfer(call, bytes, output, error)
        );
    }

    private void resolveTransfer(PluginCall call, long bytes, String output, String error) {
        if (getBridge() == null) return;

        getBridge().executeOnMainThread(() -> {
            if (error != null) {
                call.reject(error);
            } else {
                JSObject result = new JSObject();
                result.put("bytes", bytes);
                result.put("output", output == null ? "" : output);
                call.resolve(result);
            }
        });
    }

    private void emit(LocalServerManager.Snapshot snapshot) {
        if (getBridge() == null) return;

        JSObject data = snapshot.toJSObject();
        getBridge().executeOnMainThread(() -> {
            if (getBridge() != null) notifyListeners("progress", data);
        });
    }

    private void resolve(PluginCall call, LocalServerManager.Snapshot snapshot, String error) {
        if (getBridge() == null) return;

        JSObject data = snapshot.toJSObject();
        getBridge().executeOnMainThread(() -> {
            if (error != null) {
                call.reject(error);
            } else {
                call.resolve(data);
            }
        });
    }
}
