package com.opencode.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;

import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.io.RandomAccessFile;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

final class LocalServerManager {
    static final String URL = "http://127.0.0.1:4097";
    static final int PORT = 4097;
    static final String WORKSPACE = "/data/data/com.opencode.mobile/files/workspace";
    static final String STATE_IDLE = "idle";
    static final String STATE_PREPARING = "preparing";
    static final String STATE_DOWNLOADING = "downloading";
    static final String STATE_EXTRACTING = "extracting";
    static final String STATE_STARTING = "starting";
    static final String STATE_RUNNING = "running";
    static final String STATE_STOPPED = "stopped";
    static final String STATE_ERROR = "error";

    interface Listener {
        void onProgress(Snapshot snapshot);
    }

    interface Callback {
        void onResult(Snapshot snapshot, String error);
    }

    interface TransferCallback {
        void onResult(long bytes, String output, String error);
    }

    static final class Snapshot {
        final String state;
        final int progress;
        final String message;
        final String error;
        final String version;
        final String workspace;
        final boolean installed;
        final boolean running;
        final String url;
        final String dataDirectory;

        Snapshot(
            String state,
            int progress,
            String message,
            String error,
            String version,
            String workspace,
            boolean installed,
            boolean running,
            String dataDirectory
        ) {
            this.state = state;
            this.progress = progress;
            this.message = message;
            this.error = error;
            this.version = version;
            this.workspace = workspace;
            this.installed = installed;
            this.running = running;
            this.url = URL;
            this.dataDirectory = dataDirectory;
        }

        JSObject toJSObject() {
            JSObject result = new JSObject();
            result.put("state", state);
            result.put("progress", progress);
            result.put("message", message);
            result.put("error", error == null ? "" : error);
            result.put("version", version == null ? "" : version);
            result.put("workspace", workspace);
            result.put("installed", installed);
            result.put("running", running);
            result.put("url", url);
            result.put("dataDirectory", dataDirectory);
            return result;
        }
    }

    private static final String TAG = "LocalServer";
    private static final int MAX_LOG_LINES = 240;
    private static final long MAX_RUNTIME_BYTES = 512L * 1024L * 1024L;
    private static final int MAX_TAR_ENTRIES = 256;
    private static LocalServerManager instance;

    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService transferExecutor = Executors.newSingleThreadExecutor();
    private final OkHttpClient downloadClient = new OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(300, TimeUnit.SECONDS)
        .build();
    private final OkHttpClient healthClient = new OkHttpClient.Builder()
        .connectTimeout(1, TimeUnit.SECONDS)
        .readTimeout(1, TimeUnit.SECONDS)
        .build();
    private static final int HEALTH_CHECK_INTERVAL_SECONDS = 30;
    private static final int MAX_HEALTH_FAILURES = 2;

    private final Object lock = new Object();
    private final ArrayDeque<String> logs = new ArrayDeque<>();
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private final List<Callback> waiters = new ArrayList<>();
    private final OkHttpClient watchdogClient = new OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build();

    private Process process;
    private Thread pumpThread;
    private ScheduledExecutorService watchdog;
    private ScheduledFuture<?> watchdogTask;
    private boolean starting;
    private String state = STATE_IDLE;
    private int progress;
    private String message = "";
    private String lastError;
    private String version;
    private boolean installed;
    private volatile int healthFailures;

    private LocalServerManager(Context context) {
        this.context = context.getApplicationContext();
    }

    static synchronized LocalServerManager get(Context context) {
        if (instance == null) {
            instance = new LocalServerManager(context);
        }
        return instance;
    }

    void addListener(Listener listener) {
        if (listener != null && !listeners.contains(listener)) {
            listeners.add(listener);
        }
    }

    void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    void ensureStarted(Listener listener, Callback callback) {
        addListener(listener);

        Snapshot immediate = null;
        List<Callback> done = null;
        boolean shouldStart = false;

        synchronized (lock) {
            if (callback != null) waiters.add(callback);

            if (STATE_RUNNING.equals(state) && isProcessAlive()) {
                done = new ArrayList<>(waiters);
                waiters.clear();
                immediate = snapshotLocked();
                scheduleWatchdog();
            } else if (!starting) {
                starting = true;
                state = STATE_PREPARING;
                progress = 0;
                message = "Preparing the local OpenCode runtime";
                lastError = null;
                shouldStart = true;
            }
        }

        if (immediate != null) {
            emitTo(immediate, listener);
            callbackOutside(done, immediate, null);
            return;
        }
        if (!shouldStart) return;

        emit(null);
        executor.execute(this::runStart);
    }

    void stop(Callback callback) {
        synchronized (lock) {
            starting = false;
        }

        executor.execute(() -> {
            synchronized (lock) {
                stopProcessLocked();
                state = STATE_STOPPED;
                progress = 0;
                message = "Local server stopped";
                lastError = null;
            }
            stopKeepAliveService();
            cancelWatchdog();
            emit(null);

            if (callback != null) {
                callback.onResult(snapshot(), null);
            }
        });
    }

    void restart(Callback callback) {
        synchronized (lock) {
            if (starting) {
                if (callback != null) {
                    callback.onResult(snapshotLocked(), "The server is already starting.");
                }
                return;
            }
        }

        executor.execute(() -> {
            synchronized (lock) {
                stopProcessLocked();
                starting = true;
                state = STATE_PREPARING;
                progress = 0;
                message = "Restarting the local OpenCode server";
                lastError = null;
            }
            cancelWatchdog();
            emit(null);
            runStartWithCallback(callback);
        });
    }

    void repair(Callback callback) {
        synchronized (lock) {
            if (starting) {
                if (callback != null) {
                    callback.onResult(snapshotLocked(), "The server is already starting.");
                }
                return;
            }
            starting = true;
            state = STATE_PREPARING;
            progress = 0;
            message = "Removing the local runtime";
            lastError = null;
        }

        executor.execute(() -> {
            synchronized (lock) {
                stopProcessLocked();
            }
            stopKeepAliveService();
            cancelWatchdog();
            deleteRecursively(runtimeDir());
            deleteRecursively(stagingDir());
            File archive = archiveFile();
            if (archive.exists()) archive.delete();
            emit(null);
            runStartWithCallback(callback);
        });
    }

    void exportSession(String sessionID, Uri destination, TransferCallback callback) {
        transferExecutor.execute(() -> {
            long bytes = 0;
            try {
                CliContext cli = prepareCli();
                ProcessBuilder builder = new ProcessBuilder(cliCommand(cli, "export", sessionID));
                builder.directory(cli.workspace);
                configureEnvironment(builder, cli.meta, cli.files, cli.home, cli.workspace, cli.temp);
                Process process = builder.start();

                StringBuilder errors = new StringBuilder();
                Thread errorPump = captureAsync(process.getErrorStream(), errors, "opencode-export-stderr");

                try (OutputStream output = context.getContentResolver()
                    .openOutputStream(destination, "wt")) {
                    if (output == null) {
                        throw new IOException("The selected export file could not be opened.");
                    }
                    byte[] buffer = new byte[128 * 1024];
                    int read;
                    InputStream input = process.getInputStream();
                    while ((read = input.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                        bytes += read;
                    }
                    output.flush();
                }

                if (!process.waitFor(5, TimeUnit.MINUTES)) {
                    process.destroyForcibly();
                    throw new IOException("The session export timed out.");
                }
                errorPump.join(5000);
                if (process.exitValue() != 0) {
                    throw new IOException(
                        "The session export failed: " + tail(errors.toString(), "exit code " + process.exitValue())
                    );
                }
                callback.onResult(bytes, "", null);
            } catch (Throwable failure) {
                Log.e(TAG, "Session export failed", failure);
                callback.onResult(0, "", describe(failure));
            }
        });
    }

    void importSession(Uri source, TransferCallback callback) {
        transferExecutor.execute(() -> {
            try {
                CliContext cli = prepareCli();
                File staged = new File(cli.temp, "session-import-" + System.currentTimeMillis() + ".json");
                try {
                    try (InputStream input = context.getContentResolver().openInputStream(source)) {
                        if (input == null) {
                            throw new IOException("The selected session file could not be read.");
                        }
                        try (OutputStream output = new FileOutputStream(staged)) {
                            byte[] buffer = new byte[128 * 1024];
                            int read;
                            long total = 0;
                            while ((read = input.read(buffer)) != -1) {
                                total += read;
                                if (total > 512L * 1024L * 1024L) {
                                    throw new IOException("The session file is too large to import.");
                                }
                                output.write(buffer, 0, read);
                            }
                        }
                    }

                    ProcessBuilder builder = new ProcessBuilder(
                        cliCommand(cli, "import", staged.getAbsolutePath())
                    );
                    builder.directory(cli.workspace);
                    builder.redirectErrorStream(true);
                    configureEnvironment(builder, cli.meta, cli.files, cli.home, cli.workspace, cli.temp);
                    Process process = builder.start();

                    StringBuilder output = new StringBuilder();
                    Thread outputPump = captureAsync(process.getInputStream(), output, "opencode-import-output");

                    if (!process.waitFor(5, TimeUnit.MINUTES)) {
                        process.destroyForcibly();
                        throw new IOException("The session import timed out.");
                    }
                    outputPump.join(5000);
                    if (process.exitValue() != 0) {
                        throw new IOException(
                            "The session import failed: " + tail(output.toString(), "exit code " + process.exitValue())
                        );
                    }
                    callback.onResult(0, tail(output.toString(), "Session imported."), null);
                } finally {
                    staged.delete();
                }
            } catch (Throwable failure) {
                Log.e(TAG, "Session import failed", failure);
                callback.onResult(0, "", describe(failure));
            }
        });
    }

    private CliContext prepareCli() throws Exception {
        JSONObject meta = readMeta();
        File files = context.getFilesDir();
        File home = new File(files, "home");
        File workspace = new File(files, "workspace");
        File temp = new File(context.getCacheDir(), "tmp");
        mkdirs(home);
        mkdirs(workspace);
        mkdirs(temp);
        writeResolver(files);
        ensureRuntime(meta, files);
        ensureYourCertificates(meta, files);
        return new CliContext(meta, files, home, workspace, temp);
    }

    private List<String> cliCommand(CliContext cli, String... arguments) throws IOException {
        File loader = new File(context.getApplicationInfo().nativeLibraryDir, "libopencode_loader.so");
        File binary = new File(runtimeDir(), "opencode");
        if (!loader.isFile()) {
            throw new IOException("The embedded Android runtime loader is missing.");
        }
        if (!binary.isFile()) {
            throw new IOException("The OpenCode binary is missing.");
        }
        List<String> command = new ArrayList<>();
        command.add(loader.getAbsolutePath());
        command.add("--library-path");
        command.add(runtimeDir().getAbsolutePath());
        command.add(binary.getAbsolutePath());
        command.addAll(Arrays.asList(arguments));
        return command;
    }

    private void configureEnvironment(
        ProcessBuilder builder,
        JSONObject meta,
        File files,
        File home,
        File workspace,
        File temp
    ) throws Exception {
        File runtime = runtimeDir();
        File shim = new File(context.getApplicationInfo().nativeLibraryDir, "librust_pty_bionic.so");
        File certificates = new File(runtime, "cert.pem");

        Map<String, String> environment = builder.environment();
        environment.put("HOME", home.getAbsolutePath());
        environment.put("PREFIX", meta.getString("androidPrefix"));
        environment.put("XDG_CONFIG_HOME", new File(home, ".config").getAbsolutePath());
        environment.put("XDG_DATA_HOME", new File(home, ".local/share").getAbsolutePath());
        environment.put("XDG_CACHE_HOME", new File(home, ".cache").getAbsolutePath());
        environment.put("TMPDIR", temp.getAbsolutePath());
        environment.put("TMP", temp.getAbsolutePath());
        environment.put("TEMP", temp.getAbsolutePath());
        environment.put("SHELL", "/system/bin/sh");
        environment.put("TERM", "xterm-256color");
        environment.put("PATH", "/system/bin:/system/xbin:/product/bin:/apex/com.android.runtime/bin");
        environment.put("SSL_CERT_FILE", certificates.getAbsolutePath());
        environment.put("BUN_PTY_LIB", shim.getAbsolutePath());
        environment.put("OPENCODE_DISABLE_AUTOUPDATE", "1");
        environment.put("LD_LIBRARY_PATH", runtime.getAbsolutePath());
        environment.remove("LD_PRELOAD");
        GitRuntime.applyEnvironment(builder, context);
    }

    private static Thread captureAsync(InputStream source, StringBuilder sink, String name) {
        Thread thread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(source, StandardCharsets.UTF_8)
            )) {
                char[] buffer = new char[4096];
                int read;
                while ((read = reader.read(buffer)) != -1) {
                    synchronized (sink) {
                        if (sink.length() < 8000) {
                            sink.append(buffer, 0, read);
                        }
                    }
                }
            } catch (IOException ignored) {
                // The process side of the stream closed.
            }
        }, name);
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private static String tail(String text, String fallback) {
        String trimmed = text == null ? "" : text.trim();
        if (trimmed.isEmpty()) return fallback;
        return trimmed.length() <= 800
            ? trimmed
            : trimmed.substring(trimmed.length() - 800);
    }

    private static final class CliContext {
        final JSONObject meta;
        final File files;
        final File home;
        final File workspace;
        final File temp;

        CliContext(JSONObject meta, File files, File home, File workspace, File temp) {
            this.meta = meta;
            this.files = files;
            this.home = home;
            this.workspace = workspace;
            this.temp = temp;
        }
    }

    JSObject statusObject() {
        return snapshot().toJSObject();
    }

    String logs() {
        StringBuilder builder = new StringBuilder();
        synchronized (lock) {
            for (String line : logs) {
                builder.append(line).append('\n');
            }
        }
        return builder.toString();
    }

    private void runStartWithCallback(Callback callback) {
        if (callback != null) {
            synchronized (lock) {
                waiters.add(callback);
            }
        }
        runStart();
    }

    private void runStart() {
        try {
            JSONObject meta = readMeta();
            synchronized (lock) {
                version = meta.optString("version", "");
                state = STATE_PREPARING;
                progress = Math.max(progress, 1);
                message = "Checking the local runtime";
            }
            emit(null);

            File files = context.getFilesDir();
            File home = new File(files, "home");
            File workspace = new File(files, "workspace");
            File temp = new File(context.getCacheDir(), "tmp");
            mkdirs(home);
            mkdirs(workspace);
            mkdirs(temp);
            writeResolver(files);
            installCopilotRetryPlugin(home);

            ensureRuntime(meta, files);
            ensureYourCertificates(meta, files);

            synchronized (lock) {
                state = STATE_STARTING;
                progress = 94;
                message = "Starting the OpenCode server";
            }
            emit(null);

            startKeepAliveService();
            startServer(meta, files, home, workspace, temp);

            synchronized (lock) {
                progress = 97;
                message = "Waiting for OpenCode to become ready";
            }
            emit(null);
            waitForHealth();

            synchronized (lock) {
                starting = false;
                state = STATE_RUNNING;
                progress = 100;
                message = "OpenCode is ready";
                lastError = null;
                installed = true;
                healthFailures = 0;
                scheduleWatchdog();
            }
            finish(null);
        } catch (Throwable error) {
            String detail = describe(error);
            Log.e(TAG, "Could not start the local server", error);

            synchronized (lock) {
                stopProcessLocked();
                starting = false;
                state = STATE_ERROR;
                progress = 0;
                message = "The local OpenCode server could not start";
                lastError = detail;
            }
            stopKeepAliveService();
            cancelWatchdog();
            finish(detail);
        }
    }

    private void finish(String error) {
        Snapshot snapshot;
        List<Callback> done;
        synchronized (lock) {
            snapshot = snapshotLocked();
            done = new ArrayList<>(waiters);
            waiters.clear();
        }
        emit(null);
        callbackOutside(done, snapshot, error);
    }

    private void callbackOutside(List<Callback> callbacks, Snapshot snapshot, String error) {
        for (Callback callback : callbacks) {
            try {
                callback.onResult(snapshot, error);
            } catch (Throwable failure) {
                Log.w(TAG, "Local server callback failed", failure);
            }
        }
    }

    private void emit(Listener extra) {
        Snapshot snapshot = snapshot();
        if (extra != null) {
            try {
                extra.onProgress(snapshot);
            } catch (Throwable failure) {
                Log.w(TAG, "Local server listener failed", failure);
            }
        }
        for (Listener listener : listeners) {
            try {
                listener.onProgress(snapshot);
            } catch (Throwable failure) {
                Log.w(TAG, "Local server listener failed", failure);
            }
        }
    }

    private void emitTo(Snapshot snapshot, Listener extra) {
        if (extra != null) {
            try {
                extra.onProgress(snapshot);
            } catch (Throwable failure) {
                Log.w(TAG, "Local server listener failed", failure);
            }
        }
        for (Listener listener : listeners) {
            try {
                listener.onProgress(snapshot);
            } catch (Throwable failure) {
                Log.w(TAG, "Local server listener failed", failure);
            }
        }
    }

    private Snapshot snapshot() {
        synchronized (lock) {
            return snapshotLocked();
        }
    }

    private Snapshot snapshotLocked() {
        return new Snapshot(
            state,
            progress,
            message,
            lastError,
            version,
            WORKSPACE,
            installed,
            STATE_RUNNING.equals(state) && isProcessAlive(),
            new File(
                context.getFilesDir(),
                "home/.local/share/opencode"
            ).getAbsolutePath()
        );
    }

    private void update(String nextState, int nextProgress, String nextMessage) {
        synchronized (lock) {
            state = nextState;
            progress = Math.max(0, Math.min(100, nextProgress));
            message = nextMessage;
        }
        emit(null);
    }

    private JSONObject readMeta() throws Exception {
        try (
            InputStream input = context.getAssets().open("runtime.json");
            ByteArrayOutputStream output = new ByteArrayOutputStream()
        ) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return new JSONObject(output.toString("UTF-8"));
        }
    }

    private void ensureRuntime(JSONObject meta, File files) throws Exception {
        String runtimeVersion = meta.getString("version");
        File runtime = runtimeDir();
        File marker = new File(runtime, ".ready");
        if (isRuntimeReady(runtime, marker, runtimeVersion, meta)) {
            synchronized (lock) {
                installed = true;
                progress = Math.max(progress, 90);
                message = "Local runtime is ready";
            }
            emit(null);
            return;
        }

        File archive = archiveFile();
        String expected = meta.getString("sha256");
        boolean valid = false;

        if (archive.isFile() && archive.length() > 0) {
            update(STATE_EXTRACTING, 84, "Checking the downloaded runtime");
            valid = expected.equalsIgnoreCase(sha256(archive));
        }

        if (!valid) {
            if (archive.exists()) archive.delete();
            download(meta, archive);
            if (!expected.equalsIgnoreCase(sha256(archive))) {
                archive.delete();
                throw new IOException("The OpenCode runtime checksum did not match.");
            }
        }

        update(STATE_EXTRACTING, 86, "Unpacking the local runtime");
        File staging = stagingDir();
        deleteRecursively(staging);
        mkdirs(staging);

        try {
            extract(archive, staging);
            patchFile(
                new File(staging, "libc.musl-aarch64.so.1"),
                meta.getString("termuxResolver"),
                meta.getString("androidResolver")
            );
            patchFile(
                new File(staging, "opencode"),
                meta.getString("termuxPrefix"),
                meta.getString("androidPrefix")
            );
            normalizeLibstdcxx(staging);
            verifyRequired(staging, meta);

            deleteRecursively(runtime);
            if (!staging.renameTo(runtime)) {
                throw new IOException("The local runtime could not be activated.");
            }
            writeText(marker, runtimeVersion + "\n");
        } catch (Throwable error) {
            deleteRecursively(staging);
            throw error;
        }

        synchronized (lock) {
            installed = true;
            progress = 92;
            message = "Local runtime installed";
        }
        emit(null);
    }

    private boolean isRuntimeReady(File runtime, File marker, String runtimeVersion, JSONObject meta) {
        if (!runtime.isDirectory() || !marker.isFile()) return false;

        try {
            String recorded = readText(marker).trim();
            if (!runtimeVersion.equals(recorded)) return false;
        } catch (IOException error) {
            return false;
        }

        JSONArray required = meta.optJSONArray("required");
        if (required == null || required.length() == 0) return false;

        for (int index = 0; index < required.length(); index++) {
            File file = new File(runtime, required.optString(index));
            if (!file.isFile() || file.length() == 0) return false;
        }
        return true;
    }

    private void download(JSONObject meta, File archive) throws Exception {
        String url = meta.getString("url");
        File partial = new File(archive.getParentFile(), archive.getName() + ".part");
        if (partial.exists()) partial.delete();

        update(STATE_DOWNLOADING, 4, "Downloading the OpenCode runtime");

        Request request = new Request.Builder().url(url).build();
        try (Response response = downloadClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Runtime download failed with HTTP " + response.code() + ".");
            }
            ResponseBody body = response.body();
            if (body == null) throw new IOException("Runtime download returned no data.");
            long total = body.contentLength();
            long received = 0;
            int lastPercent = -1;

            try (
                InputStream input = body.byteStream();
                OutputStream output = new FileOutputStream(partial)
            ) {
                byte[] buffer = new byte[128 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    received += read;
                    if (total > 0) {
                        int percent = 4 + (int) Math.min(80, (received * 80) / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            update(STATE_DOWNLOADING, percent, "Downloading the OpenCode runtime");
                        }
                    }
                }
            }

            if (total > 0 && received != total) {
                throw new IOException("Runtime download was incomplete.");
            }
        } catch (Throwable error) {
            partial.delete();
            throw error;
        }

        if (!partial.renameTo(archive)) {
            partial.delete();
            throw new IOException("The downloaded runtime could not be saved.");
        }
    }

    private void extract(File archive, File destination) throws Exception {
        int entries = 0;
        long totalBytes = 0;
        String root = destination.getCanonicalPath();

        try (
            InputStream fileInput = new BufferedInputStream(new FileInputStream(archive));
            GzipCompressorInputStream gzip = new GzipCompressorInputStream(fileInput);
            TarArchiveInputStream tar = new TarArchiveInputStream(gzip)
        ) {
            TarArchiveEntry entry;
            while ((entry = tar.getNextEntry()) != null) {
                if (++entries > MAX_TAR_ENTRIES) {
                    throw new IOException("The runtime archive has too many entries.");
                }
                if (!tar.canReadEntryData(entry)) continue;

                String name = entry.getName();
                if (name == null || name.isEmpty()) continue;
                if (name.startsWith("/") || name.contains("..") || name.indexOf('\\') >= 0) {
                    throw new IOException("The runtime archive contains an unsafe path.");
                }

                File output = new File(destination, name);
                String canonical = output.getCanonicalPath();
                if (!canonical.equals(root) && !canonical.startsWith(root + File.separator)) {
                    throw new IOException("The runtime archive escapes its directory.");
                }

                if (entry.isDirectory()) {
                    mkdirs(output);
                    continue;
                }
                if (entry.isSymbolicLink()) {
                    continue;
                }
                if (!entry.isFile()) continue;

                totalBytes += entry.getSize();
                if (totalBytes > MAX_RUNTIME_BYTES) {
                    throw new IOException("The runtime archive is too large.");
                }

                mkdirs(output.getParentFile());
                try (OutputStream stream = new FileOutputStream(output)) {
                    byte[] buffer = new byte[128 * 1024];
                    int read;
                    while ((read = tar.read(buffer)) != -1) {
                        stream.write(buffer, 0, read);
                    }
                }
                makeReadable(output);
            }
        }

        File binary = new File(destination, "opencode");
        if (binary.isFile()) binary.setExecutable(true, false);
    }

    private void normalizeLibstdcxx(File directory) throws IOException {
        File runtime = new File(directory, "libstdc++.so.6.runtime");
        File soname = new File(directory, "libstdc++.so.6");

        if (!runtime.isFile()) {
            File[] files = directory.listFiles((dir, name) ->
                name.matches("libstdc\\+\\+\\.so\\.6(?:\\.[0-9]+)+")
            );
            if (files != null && files.length > 0) {
                Arrays.sort(files);
                copyFile(files[files.length - 1], runtime);
            }
        }

        if (!soname.isFile() && runtime.isFile()) {
            copyFile(runtime, soname);
        }
    }

    private void verifyRequired(File runtime, JSONObject meta) throws Exception {
        JSONArray required = meta.getJSONArray("required");
        for (int index = 0; index < required.length(); index++) {
            String name = required.getString(index);
            File file = new File(runtime, name);
            if (!file.isFile() || file.length() == 0) {
                throw new IOException("The runtime is missing " + name + ".");
            }
        }
    }

    private void ensureYourCertificates(JSONObject meta, File files) throws IOException {
        File runtime = runtimeDir();
        File destination = new File(runtime, "cert.pem");
        if (destination.isFile() && destination.length() > 0) return;

        File asset = new File(files, "runtime-cert.pem");
        try (
            InputStream input = context.getAssets().open("runtime/cert.pem");
            OutputStream output = new FileOutputStream(asset)
        ) {
            copy(input, output);
        } catch (IOException missingAsset) {
            asset.delete();
        }

        if (asset.isFile() && asset.length() > 0) {
            copyFile(asset, destination);
            makeReadable(destination);
            asset.delete();
            return;
        }

        StringBuilder bundle = new StringBuilder();
        for (String directory : new String[] {
            "/apex/com.android.conscrypt/cacerts",
            "/system/etc/security/cacerts",
        }) {
            File[] filesInDirectory = new File(directory).listFiles();
            if (filesInDirectory == null) continue;
            Arrays.sort(filesInDirectory);
            for (File file : filesInDirectory) {
                if (!file.isFile()) continue;
                try {
                    String text = readText(file);
                    if (text.contains("BEGIN CERTIFICATE")) {
                        bundle.append(text.trim()).append('\n');
                    }
                } catch (IOException unreadable) {
                    Log.w(TAG, "Could not read a system certificate", unreadable);
                }
            }
            if (bundle.length() > 0) break;
        }

        if (bundle.length() == 0) {
            throw new IOException("No trusted certificates are available on this device.");
        }
        writeText(destination, bundle.toString());
        makeReadable(destination);
    }

    private void installCopilotRetryPlugin(File home) {
        File directory = new File(home, ".config/opencode/plugin");
        File destination = new File(directory, "copilot-retry.js");

        try {
            mkdirs(directory);
            try (
                InputStream input = context.getAssets().open("copilot-retry.js");
                OutputStream output = new FileOutputStream(destination)
            ) {
                copy(input, output);
            }
            makeReadable(destination);
        } catch (IOException error) {
            Log.w(TAG, "Could not install the Copilot retry plugin", error);
        }
    }

    private void startServer(
        JSONObject meta,
        File files,
        File home,
        File workspace,
        File temp
    ) throws Exception {
        File runtime = runtimeDir();
        File loader = new File(context.getApplicationInfo().nativeLibraryDir, "libopencode_loader.so");
        File shim = new File(context.getApplicationInfo().nativeLibraryDir, "librust_pty_bionic.so");
        File binary = new File(runtime, "opencode");

        if (!loader.isFile()) {
            throw new IOException("The embedded Android runtime loader is missing.");
        }
        if (!binary.isFile()) {
            throw new IOException("The OpenCode binary is missing.");
        }
        if (!shim.isFile()) {
            throw new IOException("The terminal PTY support library is missing.");
        }

        List<String> command = Arrays.asList(
            loader.getAbsolutePath(),
            "--library-path",
            runtime.getAbsolutePath(),
            binary.getAbsolutePath(),
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            String.valueOf(PORT),
            "--print-logs",
            "--log-level",
            "INFO"
        );

        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(workspace);
        builder.redirectErrorStream(true);

        configureEnvironment(builder, meta, files, home, workspace, temp);

        Process started = builder.start();

        synchronized (lock) {
            process = started;
            logs.clear();
        }

        pumpThread = new Thread(() -> pumpOutput(started), "opencode-server-output");
        pumpThread.setDaemon(true);
        pumpThread.start();
    }

    private void pumpOutput(Process source) {
        File logFile = new File(context.getFilesDir(), "opencode-server.log");
        try {
            if (logFile.length() > 2L * 1024L * 1024L) {
                logFile.delete();
            }
        } catch (SecurityException ignored) {
            // Logging is best-effort.
        }

        try (
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(source.getInputStream(), StandardCharsets.UTF_8)
            );
            OutputStream output = new FileOutputStream(logFile, true);
            Writer writer = new BufferedWriter(
                new OutputStreamWriter(output, StandardCharsets.UTF_8)
            )
        ) {
            String line;
            int pending = 0;

            while ((line = reader.readLine()) != null) {
                Log.i(TAG, line);
                synchronized (lock) {
                    logs.addLast(line);
                    while (logs.size() > MAX_LOG_LINES) logs.removeFirst();
                }
                try {
                    writer.write(line);
                    writer.write("\n");
                    pending += 1;

                    // Flush in batches so a chatty server does not open and
                    // close the log file for every line.
                    if (pending >= 32) {
                        writer.flush();
                        pending = 0;
                    }
                } catch (IOException ignored) {
                    // Logging is best-effort.
                }
            }

            writer.flush();
        } catch (IOException error) {
            Log.d(TAG, "Server output stream closed", error);
        }
    }

    private void waitForHealth() throws Exception {
        long deadline = System.currentTimeMillis() + 120_000L;
        Request request = new Request.Builder().url(URL + "/global/health").build();

        while (System.currentTimeMillis() < deadline) {
            synchronized (lock) {
                if (!isProcessAlive()) {
                    throw new IOException(serverExitMessage());
                }
            }

            try (Response response = healthClient.newCall(request).execute()) {
                if (response.isSuccessful()) {
                    ResponseBody body = response.body();
                    String text = body == null ? "" : body.string();
                    if (text.replaceAll("\\s+", "").contains("\"healthy\":true")) return;
                }
            } catch (IOException ignored) {
                // The server is still starting.
            }

            Thread.sleep(500L);
        }

        throw new IOException("The OpenCode server did not become ready in time.");
    }

    private String serverExitMessage() {
        String tail;
        synchronized (lock) {
            StringBuilder builder = new StringBuilder();
            int skip = Math.max(0, logs.size() - 8);
            int index = 0;
            for (String line : logs) {
                if (index++ >= skip) builder.append(line).append('\n');
            }
            tail = builder.toString().trim();
        }
        return tail.isEmpty()
            ? "The OpenCode server stopped unexpectedly."
            : "The OpenCode server stopped unexpectedly: " + tail;
    }

    private boolean isProcessAlive() {
        if (process == null) return false;
        try {
            process.exitValue();
            return false;
        } catch (IllegalThreadStateException alive) {
            return true;
        }
    }

    private void stopProcessLocked() {
        Process current = process;
        process = null;
        if (current == null) return;

        current.destroy();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!current.waitFor(5, TimeUnit.SECONDS)) {
                    current.destroyForcibly();
                }
            } else {
                current.waitFor();
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            current.destroyForcibly();
        }
    }

    void ensureKeepAliveService() {
        synchronized (lock) {
            if (!starting && !STATE_RUNNING.equals(state)) return;
        }
        startKeepAliveService();
    }

    private void startKeepAliveService() {
        try {
            Intent intent = new Intent(context, LocalServerService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Throwable error) {
            Log.w(TAG, "Could not start the keep-alive service", error);
        }
    }

    private void stopKeepAliveService() {
        try {
            context.stopService(new Intent(context, LocalServerService.class));
        } catch (Throwable error) {
            Log.w(TAG, "Could not stop the keep-alive service", error);
        }
    }

    void ensureAlive() {
        synchronized (lock) {
            if (starting || !STATE_RUNNING.equals(state)) return;
        }

        try {
            Request request = new Request.Builder().url(URL + "/global/health").build();
            try (Response response = watchdogClient.newCall(request).execute()) {
                if (response.isSuccessful()) {
                    ResponseBody body = response.body();
                    String text = body == null ? "" : body.string();
                    if (text.replaceAll("\\s+", "").contains("\"healthy\":true")) {
                        healthFailures = 0;
                        return;
                    }
                }
            }
        } catch (IOException ignored) {
            // The server may be temporarily busy or unreachable.
        }

        healthFailures += 1;
        if (healthFailures < MAX_HEALTH_FAILURES) return;

        healthFailures = 0;
        Log.w(TAG, "Server health check failed; restarting the local server");
        restart(null);
    }

    private void scheduleWatchdog() {
        cancelWatchdog();
        watchdog = Executors.newSingleThreadScheduledExecutor();
        watchdogTask = watchdog.scheduleAtFixedRate(
            this::ensureAlive,
            HEALTH_CHECK_INTERVAL_SECONDS,
            HEALTH_CHECK_INTERVAL_SECONDS,
            TimeUnit.SECONDS
        );
    }

    private void cancelWatchdog() {
        if (watchdogTask != null) {
            watchdogTask.cancel(false);
            watchdogTask = null;
        }
        if (watchdog != null) {
            watchdog.shutdownNow();
            watchdog = null;
        }
    }

    private void writeResolver(File files) {
        List<String> servers = new ArrayList<>();
        try {
            ConnectivityManager manager = (ConnectivityManager) context.getSystemService(
                Context.CONNECTIVITY_SERVICE
            );
            if (manager != null) {
                Network network = manager.getActiveNetwork();
                LinkProperties properties = network == null ? null : manager.getLinkProperties(network);
                if (properties != null) {
                    for (InetAddress address : properties.getDnsServers()) {
                        String host = address.getHostAddress();
                        if (host == null || host.isEmpty() || host.contains("%")) continue;
                        if (address.isLoopbackAddress() || address.isLinkLocalAddress()) continue;
                        if (!servers.contains(host)) servers.add(host);
                    }
                }
            }
        } catch (Throwable error) {
            Log.w(TAG, "Could not read the active DNS servers", error);
        }

        if (servers.isEmpty()) {
            servers.add("8.8.8.8");
            servers.add("1.1.1.1");
        }

        StringBuilder contents = new StringBuilder();
        for (String server : servers) {
            contents.append("nameserver ").append(server).append('\n');
        }
        contents.append("options timeout:2 attempts:2\n");

        try {
            File resolver = new File(files, ".r");
            writeText(resolver, contents.toString());
            resolver.setReadable(false, false);
            resolver.setReadable(true, true);
            resolver.setWritable(false, false);
            resolver.setWritable(true, true);
        } catch (IOException error) {
            Log.w(TAG, "Could not write the resolver configuration", error);
        }
    }

    private File runtimeDir() {
        return new File(context.getFilesDir(), "runtime");
    }

    private File stagingDir() {
        return new File(context.getFilesDir(), "runtime-staging");
    }

    private File archiveFile() {
        String runtimeVersion;
        synchronized (lock) {
            runtimeVersion = version;
        }
        if (runtimeVersion == null || runtimeVersion.isEmpty()) runtimeVersion = "runtime";
        return new File(context.getCacheDir(), "opencode-" + runtimeVersion + ".tar.gz");
    }

    private static void mkdirs(File directory) throws IOException {
        if (directory.isDirectory()) return;
        if (!directory.mkdirs() && !directory.isDirectory()) {
            throw new IOException("Could not create " + directory.getName() + ".");
        }
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursively(child);
            }
        }
        if (!file.delete() && file.exists()) {
            Log.w(TAG, "Could not delete " + file.getAbsolutePath());
        }
    }

    private static void copyFile(File source, File destination) throws IOException {
        try (
            InputStream input = new FileInputStream(source);
            OutputStream output = new FileOutputStream(destination)
        ) {
            copy(input, output);
        }
        makeReadable(destination);
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[128 * 1024];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
    }

    private static void makeReadable(File file) {
        file.setReadable(false, false);
        file.setReadable(true, false);
        file.setWritable(false, false);
        file.setWritable(true, true);
    }

    private static String readText(File file) throws IOException {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)
        )) {
            char[] buffer = new char[8192];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                builder.append(buffer, 0, read);
            }
        }
        return builder.toString();
    }

    private static void writeText(File file, String text) throws IOException {
        File parent = file.getParentFile();
        if (parent != null) mkdirs(parent);
        try (OutputStream output = new FileOutputStream(file)) {
            output.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static void patchFile(File file, String oldValue, String newValue) throws IOException {
        byte[] oldBytes = oldValue.getBytes(StandardCharsets.UTF_8);
        byte[] newBytes = newValue.getBytes(StandardCharsets.UTF_8);
        if (newBytes.length > oldBytes.length) {
            throw new IOException("A runtime path is too long to patch.");
        }

        long found = -1;
        try (RandomAccessFile random = new RandomAccessFile(file, "rw")) {
            long length = random.length();
            if (length > Integer.MAX_VALUE) {
                throw new IOException("The runtime file is too large to patch.");
            }
            byte[] buffer = new byte[1024 * 1024];
            int matched = 0;
            long position = 0;
            long start = -1;

            scan:
            while (position < length) {
                int read = random.read(buffer);
                if (read <= 0) break;
                for (int index = 0; index < read; index++) {
                    byte value = buffer[index];
                    if (value == oldBytes[matched]) {
                        if (matched == 0) start = position + index;
                        matched++;
                        if (matched == oldBytes.length) {
                            found = start;
                            break scan;
                        }
                    } else {
                        matched = value == oldBytes[0] ? 1 : 0;
                        start = position + index;
                    }
                }
                position += read;
            }

            if (found < 0) {
                throw new IOException("The runtime does not contain the expected Android path.");
            }

            byte[] replacement = new byte[oldBytes.length];
            System.arraycopy(newBytes, 0, replacement, 0, newBytes.length);
            random.seek(found);
            random.write(replacement);
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[256 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest()) {
            result.append(String.format(Locale.US, "%02x", value));
        }
        return result.toString();
    }

    private static String describe(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) {
            return error.getClass().getSimpleName();
        }
        return message;
    }
}
