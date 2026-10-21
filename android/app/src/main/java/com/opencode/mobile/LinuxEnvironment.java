package com.opencode.mobile;

import android.content.Context;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream;

@CapacitorPlugin(name = "LinuxEnvironment")
public class LinuxEnvironment extends Plugin {
    private static final String TAG = "LinuxEnvironment";
    private static final String ROOTFS_RELATIVE = "linux/rootfs";
    private static final String MARKER_READY = ".ready";
    // Official Alpine aarch64 minirootfs mirror. Change this constant if the mirror/path moves.
    private static final String ALPINE_ROOTFS_URL =
        "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/aarch64/alpine-minirootfs-3.20.3-aarch64.tar.gz";
    private static final long MAX_ROOTFS_BYTES = 512L * 1024 * 1024 * 1024L;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(300, TimeUnit.SECONDS)
        .build();

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ready", isLinuxReady());
        result.put("rootfsPath", rootfsPath().getAbsolutePath());
        call.resolve(result);
    }

    @PluginMethod
    public void ensureLinux(PluginCall call) {
        executor.execute(() -> {
            try {
                File rootfs = ensureRootfs();
                JSObject result = new JSObject();
                result.put("ready", true);
                result.put("rootfsPath", rootfs.getAbsolutePath());
                finish(call, result);
            } catch (Exception failure) {
                reject(call, failure, null);
            }
        });
    }

    @PluginMethod
    public void runCommand(PluginCall call) {
        String command = call.getString("command");
        if (command == null || command.trim().isEmpty()) {
            call.reject("A command is required.");
            return;
        }
        executor.execute(() -> {
            try {
                if (!isLinuxReady()) {
                    call.reject("The Linux environment is not ready. Call ensureLinux first.");
                    return;
                }
                ProcessResult result = runLinuxCommand(command);
                JSObject res = new JSObject();
                res.put("exitCode", result.exitCode);
                res.put("output", result.output);
                finish(call, res);
            } catch (Exception failure) {
                reject(call, failure, null);
            }
        });
    }

    @PluginMethod
    public void installPackage(PluginCall call) {
        String pkg = call.getString("package");
        if (pkg == null || pkg.trim().isEmpty()) {
            call.reject("A package name is required.");
            return;
        }
        executor.execute(() -> {
            try {
                if (!isLinuxReady()) {
                    call.reject("The Linux environment is not ready. Call ensureLinux first.");
                    return;
                }
                ProcessResult result = runLinuxCommand("apk add --no-cache " + pkg);
                JSObject res = new JSObject();
                res.put("exitCode", result.exitCode);
                res.put("output", result.output);
                finish(call, res);
            } catch (Exception failure) {
                reject(call, failure, null);
            }
        });
    }

    @PluginMethod
    public void rootfsPath(PluginCall call) {
        JSObject result = new JSObject();
        result.put("path", rootfsPath().getAbsolutePath());
        call.resolve(result);
    }

    private boolean isLinuxReady() {
        File rootfs = rootfsPath();
        return rootfs.isDirectory() && new File(rootfs, "bin/sh").isFile()
            && new File(rootfs, MARKER_READY).isFile();
    }

    private File rootfsPath() {
        return new File(getContext().getFilesDir(), ROOTFS_RELATIVE);
    }

    private File ensureRootfs() throws Exception {
        File rootfs = rootfsPath();
        if (isLinuxReady()) {
            return rootfs;
        }

        File archive = new File(getContext().getCacheDir(), "alpine-minirootfs.tar.gz");
        download(ALPINE_ROOTFS_URL, archive);

        File staging = new File(getContext().getFilesDir(), "linux-staging");
        deleteRecursively(staging);
        staging.mkdirs();

        extract(archive, staging);

        File sh = new File(staging, "bin/sh");
        if (!sh.isFile()) {
            throw new IOException("The rootfs archive does not contain /bin/sh.");
        }

        deleteRecursively(rootfs);
        if (!staging.renameTo(rootfs)) {
            throw new IOException("The Linux rootfs could not be activated.");
        }
        writeText(new File(rootfs, MARKER_READY), "1\n");
        return rootfs;
    }

    private ProcessResult runLinuxCommand(String command) throws Exception {
        File rootfs = rootfsPath();
        List<String> cmd = new ArrayList<>();
        cmd.add(new File(rootfs, "bin/sh").getAbsolutePath());
        cmd.add("-c");
        cmd.add(command);

        ProcessBuilder builder = new ProcessBuilder(cmd);
        builder.directory(rootfs);
        builder.redirectErrorStream(true);
        Map<String, String> env = builder.environment();
        env.put("HOME", rootfs.getAbsolutePath());
        env.put("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
        env.put("LD_LIBRARY_PATH",
            new File(rootfs, "lib").getAbsolutePath() + ":" + new File(rootfs, "usr/lib").getAbsolutePath());

        Process process = builder.start();
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append('\n');
            }
        }
        int code = process.waitFor();
        return new ProcessResult(code, output.toString().trim());
    }

    private void download(String urlString, File destination) throws Exception {
        File partial = new File(destination.getParentFile(), destination.getName() + ".part");
        if (partial.exists()) {
            partial.delete();
        }

        Request request = new Request.Builder().url(urlString).build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Linux rootfs download failed with HTTP " + response.code() + ".");
            }
            ResponseBody body = response.body();
            if (body == null) {
                throw new IOException("Linux rootfs download returned no data.");
            }
            try (InputStream input = body.byteStream();
                 FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[128 * 1024];
                int read;
                long total = 0;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    total += read;
                    if (total > MAX_ROOTFS_BYTES) {
                        throw new IOException("The Linux rootfs archive is too large.");
                    }
                }
            }
        }
        if (!partial.renameTo(destination)) {
            throw new IOException("The Linux rootfs archive could not be saved.");
        }
    }

    private void extract(File archive, File destination) throws Exception {
        String rootCanonical = destination.getCanonicalPath();
        try (
            InputStream fileInput = new BufferedInputStream(new FileInputStream(archive));
            GzipCompressorInputStream gzip = new GzipCompressorInputStream(fileInput);
            TarArchiveInputStream tar = new TarArchiveInputStream(gzip)
        ) {
            TarArchiveEntry entry;
            while ((entry = tar.getNextEntry()) != null) {
                if (!tar.canReadEntryData(entry)) {
                    continue;
                }
                String name = entry.getName();
                if (name == null || name.isEmpty()) {
                    continue;
                }
                if (name.startsWith("/") || name.contains("..") || name.indexOf('\\') >= 0) {
                    throw new IOException("The rootfs archive contains an unsafe path: " + name);
                }
                File output = new File(destination, name);
                String canonical = output.getCanonicalPath();
                if (!canonical.equals(rootCanonical)
                    && !canonical.startsWith(rootCanonical + File.separator)) {
                    throw new IOException("The rootfs archive escapes its directory: " + name);
                }
                if (entry.isDirectory()) {
                    output.mkdirs();
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                output.getParentFile().mkdirs();
                try (FileOutputStream stream = new FileOutputStream(output)) {
                    byte[] buffer = new byte[128 * 1024];
                    int read;
                    while ((read = tar.read(buffer)) != -1) {
                        stream.write(buffer, 0, read);
                    }
                }
                output.setReadable(true, false);
                String base = new File(name).getName();
                if (base.equals("sh") || base.equals("busybox") || base.equals("apk")) {
                    output.setExecutable(true, false);
                }
            }
        }
    }

    private void finish(PluginCall call, JSObject result) {
        if (getBridge() == null) {
            return;
        }
        getBridge().executeOnMainThread(() -> call.resolve(result));
    }

    private void reject(PluginCall call, Exception failure, String token) {
        String message = failure.getMessage();
        if (message == null || message.trim().isEmpty()) {
            message = "The Linux environment operation failed.";
        }
        if (token != null && !token.isEmpty()) {
            message = message.replace(token, "***");
        }
        if (message.length() > 2000) {
            message = message.substring(message.length() - 2000);
        }
        String finalMessage = message;
        if (getBridge() == null) {
            return;
        }
        getBridge().executeOnMainThread(() -> call.reject(finalMessage));
    }

    private static void writeText(File file, String text) throws IOException {
        File parent = file.getParentFile();
        if (parent != null) {
            mkdirs(parent);
        }
        try (OutputStream output = new FileOutputStream(file)) {
            output.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static void mkdirs(File directory) throws IOException {
        if (directory.isDirectory()) {
            return;
        }
        if (!directory.mkdirs() && !directory.isDirectory()) {
            throw new IOException("Could not create " + directory.getAbsolutePath() + ".");
        }
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        if (!file.delete() && file.exists()) {
            Log.w(TAG, "Could not delete " + file.getAbsolutePath());
        }
    }

    private static final class ProcessResult {
        final int exitCode;
        final String output;

        ProcessResult(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output;
        }
    }
}
