package com.opencode.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

@CapacitorPlugin(name = "PtySocket")
public class PtySocketPlugin extends Plugin {

    private final Map<String, WebSocket> sockets = new ConcurrentHashMap<>();
    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build();

    private void emit(String event, JSObject data) {
        if (getBridge() == null) return;

        getBridge().executeOnMainThread(() -> {
            if (getBridge() != null) notifyListeners(event, data);
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String url = call.getString("url");
        String id = call.getString("id");

        if (url == null || id == null) {
            call.reject("The terminal socket requires a URL and identifier.");
            return;
        }

        if (sockets.containsKey(id)) {
            call.reject("The terminal socket is already open.");
            return;
        }

        Request request = new Request.Builder().url(url).build();
        final boolean[] opened = { false };

        WebSocket socket = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                opened[0] = true;
                getBridge().executeOnMainThread(() ->
                        call.resolve(new JSObject().put("id", id))
                );
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                emit("message", new JSObject().put("id", id).put("text", text));
            }

            @Override
            public void onMessage(WebSocket webSocket, ByteString bytes) {
                // PTY metadata frames are not needed by the terminal renderer.
            }

            @Override
            public void onClosing(WebSocket webSocket, int code, String reason) {
                webSocket.close(1000, null);
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                sockets.remove(id);
                emit("closed", new JSObject()
                        .put("id", id)
                        .put("code", code)
                        .put("reason", reason));
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable failure, Response response) {
                sockets.remove(id);
                String message = failure.getMessage() == null
                        ? "The terminal connection failed."
                        : failure.getMessage();

                if (!opened[0]) {
                    getBridge().executeOnMainThread(() -> call.reject(message));
                }

                emit("failure", new JSObject().put("id", id).put("message", message));
            }
        });

        sockets.put(id, socket);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String id = call.getString("id");
        String data = call.getString("data");
        WebSocket socket = id == null ? null : sockets.get(id);

        if (socket == null || data == null) {
            call.reject("The terminal socket is not open.");
            return;
        }

        if (socket.send(data)) {
            call.resolve();
        } else {
            call.reject("The terminal socket is not accepting input.");
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        String id = call.getString("id");
        WebSocket socket = id == null ? null : sockets.remove(id);

        if (socket != null) socket.close(1000, "client closed");
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (WebSocket socket : sockets.values()) {
            socket.close(1000, "app closed");
        }

        sockets.clear();
        super.handleOnDestroy();
    }
}
