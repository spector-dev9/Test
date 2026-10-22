package com.opencode.mobile;

import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
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
    private static final String PROOT_LIBRARY = "libproot.so";
    private static final String PROOT_LOADER_LIBRARY = "libproot_loader.so";
    private static final String PROOT_TALLOC_LIBRARY = "libtalloc.so";
    private static final String PROOT_SHMEM_LIBRARY = "libandroid-shmem.so";
    private static final String MARKER_READY = ".ready";
    // Official Alpine aarch64 minirootfs mirror. Change this constant if the mirror/path moves.
    private static final String ALPINE_ROOTFS_URL =
        "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/aarch64/alpine-minirootfs-3.20.3-aarch64.tar.gz";
    private static final String ALPINE_ROOTFS_SHA256 =
        "041fa34a81788242df9e78fa69b97ab45b8ec47ddbf88864755610414a7bf3de";
    // The same release unpacked: the APK ships the plain tar, the download uses the gzip.
    private static final String ALPINE_ROOTFS_TAR_SHA256 =
        "909cd5ea844eecebecee4b5e80e98709c7cfbb2e95748c787c211bf1698aaae2";
    private static final String ASSET_ROOTFS_TAR = "linux/alpine-minirootfs.tar";
    private static final String ASSET_ROOTFS_GZ = "linux/alpine-minirootfs.tar.gz";
    private static final String RESOLV_CONF = "nameserver 1.1.1.1\nnameserver 8.8.8.8\n";
    private static final String ALPINE_NODE_REPOSITORY =
        "https://dl-cdn.alpinelinux.org/alpine/v3.21/main";
    private static final long MAX_ROOTFS_BYTES = 512L * 1024 * 1024 * 1024L;
    private static final long COMMAND_TIMEOUT_MS = 10 * 60 * 1000L;

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
        boolean ready = isLinuxReady();
        result.put("ready", ready);
        result.put("reason", ready ? "" : notReadyReason());
        result.put("rootfsPath", rootfsPath().getAbsolutePath());
        call.resolve(result);
    }

    @PluginMethod
    public void ensureLinux(PluginCall call) {
        executor.execute(() -> {
            try {
                File rootfs = ensureRootfs();
                try {
                    configurePackageRepository(rootfs);
                } catch (IOException failure) {
                    // The base environment is still usable without this; Node.js
                    // can then be installed from the v3.21 branch by hand.
                    Log.w(TAG, "Could not add the Node.js package repository.", failure);
                }
                ensureProot();
                boolean nodeReady = false;
                try {
                    nodeReady = ensureNode();
                } catch (Exception failure) {
                    Log.w(TAG, "Could not install Node.js.", failure);
                }
                writeResolv(rootfs);
                writeText(new File(rootfs, MARKER_READY), "1\n");
                JSObject result = new JSObject();
                result.put("ready", true);
                result.put("nodeReady", nodeReady);
                result.put("rootfsPath", rootfs.getAbsolutePath());
                result.put("prootPath", prootPath().getAbsolutePath());
                finish(call, result);
            } catch (Exception failure) {
                reject(call, failure, null);
            }
        });
    }

    @PluginMethod
    public void runCommand(PluginCall call) {
        String command = call.getString("command");
        String directory = call.getString("directory");
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
                ProcessResult result = runLinuxCommand(command, directory);
                JSObject res = new JSObject();
                res.put("exitCode", result.exitCode);
                res.put("output", result.output);
                res.put("workingDirectory", workingDirectory(directory));
                finish(call, res);
            } catch (Exception failure) {
                reject(call, failure, null);
            }
        });
    }

    @PluginMethod
    public void installPackage(PluginCall call) {
        String pkg = call.getString("package");
        String directory = call.getString("directory");
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
                ProcessResult result =
                    runLinuxCommand("apk add --no-cache " + pkg, directory);
                String output = result.output;
                // apk runs post-install triggers (busybox reindexes /bin and
                // /usr/bin); under PRoot one can fail after the package itself
                // is installed. Verify the package before reporting that case.
                if (result.exitCode != 0 && allPackagesInstalled(pkg)) {
                    output = output
                        + "\nNote: apk reported an error, but " + pkg
                        + " is installed and ready to use. The error came from a"
                        + " post-install trigger and can be ignored.";
                }
                JSObject res = new JSObject();
                res.put("exitCode", result.exitCode);
                res.put("output", output);
                finish(call, res);
            } catch (Exception failure) {
                reject(call, failure, null);
            }
        });
    }

    private boolean allPackagesInstalled(String pkgSpec) {
        for (String spec : pkgSpec.trim().split("\\s+")) {
            String name = spec.split("[=@]", 2)[0];
            if (!name.matches("[A-Za-z0-9._+-]+")) {
                return false;
            }
            try {
                if (runLinuxCommand("apk info -e " + name, null).exitCode != 0) {
                    return false;
                }
            } catch (Exception failure) {
                return false;
            }
        }
        return true;
    }

    @PluginMethod
    public void rootfsPath(PluginCall call) {
        JSObject result = new JSObject();
        result.put("path", rootfsPath().getAbsolutePath());
        call.resolve(result);
    }

    private boolean isLinuxReady() {
        return hasRootfs()
            && prootPath().isFile()
            && prootLoaderPath().isFile()
            && nativeLibraryFile(PROOT_TALLOC_LIBRARY).isFile()
            && nativeLibraryFile(PROOT_SHMEM_LIBRARY).isFile()
            && new File(rootfsPath(), MARKER_READY).isFile();
    }

    private String notReadyReason() {
        if (!prootPath().isFile()
            || !prootLoaderPath().isFile()
            || !nativeLibraryFile(PROOT_TALLOC_LIBRARY).isFile()
            || !nativeLibraryFile(PROOT_SHMEM_LIBRARY).isFile()) {
            return "This build does not include the embedded PRoot runtime. "
                + "Install the latest build of the app.";
        }

        if (!hasRootfs()) {
            return "The Alpine rootfs is not extracted yet.";
        }

        if (!new File(rootfsPath(), MARKER_READY).isFile()) {
            return "The Alpine environment has not been prepared yet.";
        }

        return "The Linux environment is not ready.";
    }

    private boolean hasRootfs() {
        File rootfs = rootfsPath();
        return rootfs.isDirectory()
            && entryExists(new File(rootfs, "bin/sh"))
            && entryExists(new File(rootfs, "usr/bin/env"));
    }

    private File rootfsPath() {
        return new File(getContext().getFilesDir(), ROOTFS_RELATIVE);
    }

    private File prootPath() {
        return nativeLibraryFile(PROOT_LIBRARY);
    }

    private File prootLoaderPath() {
        return nativeLibraryFile(PROOT_LOADER_LIBRARY);
    }

    private File nativeLibraryFile(String name) {
        return new File(getContext().getApplicationInfo().nativeLibraryDir, name);
    }

    private File prootTmpDir() throws IOException {
        File directory = new File(getContext().getCacheDir(), "proot");
        mkdirs(directory);
        return directory;
    }

    private File ensureRootfs() throws Exception {
        File rootfs = rootfsPath();
        if (hasRootfs()) {
            return rootfs;
        }

        File archive = new File(getContext().getCacheDir(), "alpine-minirootfs.archive");
        if (!copyBundledRootfs(archive)) {
            download(ALPINE_ROOTFS_URL, archive, "rootfs archive");
            if (!matchesSha256(archive, ALPINE_ROOTFS_SHA256)) {
                archive.delete();
                throw new IOException("The downloaded Linux rootfs does not match its checksum.");
            }
        }

        // Extract into a fresh directory every time. Reusing one name means a
        // leftover entry from a killed extraction (which the app may no longer
        // be able to remove) would make every later attempt fail at the same path.
        File staging = new File(
            getContext().getFilesDir(), "linux-staging-" + System.currentTimeMillis());
        cleanupStaleStaging();
        mkdirs(staging);

        try {
            extract(archive, staging);

            // Alpine's /bin/sh and /usr/bin/env are absolute symlinks to
            // /bin/busybox, so they are intentionally dangling outside proot:
            // check the links themselves instead of following them.
            if (!entryExists(new File(staging, "bin/sh"))
                || !entryExists(new File(staging, "usr/bin/env"))) {
                throw new IOException("The rootfs archive does not contain /bin/sh.");
            }

            deleteRecursively(rootfs);
            File parent = rootfs.getParentFile();
            if (parent != null) {
                mkdirs(parent);
            }
            if (!staging.renameTo(rootfs)) {
                throw new IOException("The Linux rootfs could not be activated.");
            }
        } finally {
            deleteRecursively(staging);
        }
        archive.delete();
        writeResolv(rootfs);
        return rootfs;
    }

    private void cleanupStaleStaging() {
        File[] entries = getContext().getFilesDir().listFiles();
        if (entries == null) {
            return;
        }
        for (File entry : entries) {
            if (entry.getName().startsWith("linux-staging")) {
                deleteRecursively(entry);
            }
        }
    }

    private boolean ensureNode() throws Exception {
        if (isNodeUsable()) {
            return true;
        }
        String install = "apk add --no-cache -u ";
        if (!hasNodeRepository()) {
            install += "--repository=" + ALPINE_NODE_REPOSITORY + " ";
        }
        install += "nodejs npm";
        ProcessResult result = runLinuxCommand(install, null);
        if (result.exitCode != 0 && !allPackagesInstalled("nodejs npm")) {
            Log.w(TAG, "apk could not install Node.js: " + result.output);
            return false;
        }
        if (isNodeUsable()) {
            return true;
        }
        Log.w(TAG, "Node.js was installed but is not usable: " + result.output);
        return false;
    }

    private boolean isNodeUsable() throws Exception {
        ProcessResult check = runLinuxCommand("node -v && npm -v", null);
        if (check.exitCode != 0) {
            return false;
        }
        for (String line : check.output.split("\n")) {
            if (line.startsWith("v")) {
                return line.trim().matches("v(2[2-9]|[3-9][0-9])\\..*");
            }
        }
        return false;
    }

    private boolean hasNodeRepository() {
        try {
            return readText(new File(rootfsPath(), "etc/apk/repositories"))
                .contains("v3.21/main");
        } catch (IOException failure) {
            return false;
        }
    }

    private void ensureProot() throws IOException {
        File loader = prootLoaderPath();
        if (!prootPath().isFile() || !loader.isFile()) {
            throw new IOException(
                "The embedded PRoot runtime is missing from this build.");
        }
        if (!nativeLibraryFile(PROOT_TALLOC_LIBRARY).isFile()
            || !nativeLibraryFile(PROOT_SHMEM_LIBRARY).isFile()) {
            throw new IOException(
                "The embedded PRoot libraries are missing from this build.");
        }
    }

    private void writeResolv(File rootfs) throws IOException {
        File resolv = new File(rootfs, "etc/resolv.conf");
        if (resolv.isFile()) {
            return;
        }
        writeText(resolv, RESOLV_CONF);
    }

    private void configurePackageRepository(File rootfs) throws IOException {
        File repositories = new File(rootfs, "etc/apk/repositories");
        if (!repositories.isFile()) {
            return;
        }
        // The bundled minirootfs ships this file as 0444. The app owns it, so
        // it can grant itself write access before appending.
        if (!repositories.canWrite() && !repositories.setWritable(true, true)) {
            throw new IOException("The Alpine package list is read-only.");
        }
        String current = readText(repositories);
        // Alpine 3.20 ships Node.js 20.15, which npm rejects when it resolves
        // optional dependencies that need ^20.19 or newer (Vite 8, ESLint 10).
        // Node.js 22 from 3.21 keeps the rest of the 3.20 base in place.
        if (!current.contains("v3.20/") || current.contains("v3.21/main")) {
            return;
        }
        String next = current.endsWith("\n") ? current : current + "\n";
        writeText(repositories, next + ALPINE_NODE_REPOSITORY + "\n");
    }

    private static String readText(File file) throws IOException {
        try (
            InputStream input = new BufferedInputStream(new FileInputStream(file));
            ByteArrayOutputStream output = new ByteArrayOutputStream()
        ) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : bytes) {
                hex.append(String.format(Locale.US, "%02x", b));
            }
            return hex.toString();
        } catch (Exception failure) {
            return null;
        }
    }

    private File nodeModulesStore(File workspace, String command) throws IOException {
        if (workspace == null || !usesNodeModules(workspace, command)) {
            return null;
        }
        File appRoot = getContext().getFilesDir().getCanonicalFile();
        String workspacePath = workspace.getCanonicalPath();
        if (workspacePath.equals(appRoot.getPath())
            || workspacePath.startsWith(appRoot.getPath() + File.separator)) {
            return null;
        }
        File mountPoint = new File(workspace, "node_modules");
        if (!mountPoint.isDirectory()) {
            if (mountPoint.exists() || !mountPoint.mkdirs()) {
                Log.w(TAG, "Could not prepare " + mountPoint + " for node_modules.");
                return null;
            }
        }
        String key = sha256Hex(workspacePath);
        if (key == null) {
            return null;
        }
        File store = new File(appRoot, "linux/node_modules/" + key.substring(0, 16));
        mkdirs(store);
        return store;
    }

    private static boolean usesNodeModules(File workspace, String command) {
        if (new File(workspace, "package.json").isFile()
            || new File(workspace, "node_modules").isDirectory()) {
            return true;
        }
        return command != null
            && command.matches("(?s).*\\b(npm|npx|pnpm|yarn|corepack|bunx?)\\b.*");
    }

    private File resolveWorkspace(String value) {
        if (value == null || value.trim().isEmpty()) return null;

        try {
            File directory = new File(value.trim()).getCanonicalFile();
            return directory.isDirectory() ? directory : null;
        } catch (IOException failure) {
            return null;
        }
    }

    private String workingDirectory(String value) {
        File workspace = resolveWorkspace(value);
        return workspace == null ? "/root" : workspace.getAbsolutePath();
    }

    private ProcessResult runLinuxCommand(String command, String directory)
        throws Exception {
        File rootfs = rootfsPath();
        File proot = prootPath();
        File workspace = resolveWorkspace(directory);
        writeResolv(rootfs);

        List<String> argv = new ArrayList<>();
        argv.add(proot.getAbsolutePath());
        // Android SELinux denies hard links inside app-private storage, which
        // apk needs when installing packages. PRoot can emulate them as symlinks.
        argv.add("--link2symlink");
        argv.add("-0");
        argv.add("-r");
        argv.add(rootfs.getAbsolutePath() + "/");
        argv.add("-b");
        argv.add("/dev/");
        argv.add("-b");
        argv.add("/sys/");
        argv.add("-b");
        argv.add("/proc/");
        if (workspace != null) {
            // Make the project folder visible inside the guest at the same
            // path so the agent and the terminal share one workspace.
            String path = workspace.getAbsolutePath();
            argv.add("-b");
            argv.add(path + ":" + path);
            File nodeModules = null;
            try {
                nodeModules = nodeModulesStore(workspace, command);
            } catch (IOException failure) {
                Log.w(TAG, "Could not prepare the private node_modules store.", failure);
            }
            if (nodeModules != null) {
                String mountPoint = new File(workspace, "node_modules").getAbsolutePath();
                argv.add("-b");
                argv.add(nodeModules.getAbsolutePath() + ":" + mountPoint);
            }
        }
        argv.add("-w");
        argv.add(workspace == null ? "/root" : workspace.getAbsolutePath());
        argv.add("/usr/bin/env");
        argv.add("HOME=/root");
        argv.add("PATH=/usr/local/sbin:/usr/local/bin:/bin:/usr/bin:/sbin:/usr/sbin");
        argv.add("SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt");
        argv.add("SSL_CERT_DIR=/etc/ssl/certs");
        argv.add("sh");
        argv.add("-c");
        argv.add(command);

        ProcessBuilder builder = new ProcessBuilder(argv);
        builder.directory(rootfs);
        builder.redirectErrorStream(true);
        Map<String, String> env = builder.environment();
        // A clean environment is required: host variables (including certificate
        // settings and the Termux prefix) leak into the guest and break apk.
        env.clear();
        env.put("PROOT_TMP_DIR", prootTmpDir().getAbsolutePath());
        env.put("PROOT_LOADER", prootLoaderPath().getAbsolutePath());

        Process process = builder.start();
        Thread watchdog = new Thread(() -> {
            try {
                Thread.sleep(COMMAND_TIMEOUT_MS);
                Log.w(TAG, "Command timed out after 10 minutes; killing.");
                process.destroy();
            } catch (InterruptedException ignored) {
                // Command finished first.
            }
        });
        watchdog.setDaemon(true);
        watchdog.start();

        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append('\n');
            }
        }
        try {
            int code = process.waitFor();
            return new ProcessResult(code, output.toString().trim());
        } finally {
            watchdog.interrupt();
        }
    }

    private void download(String urlString, File destination, String label) throws Exception {
        File partial = new File(destination.getParentFile(), destination.getName() + ".part");
        if (partial.exists()) {
            partial.delete();
        }

        Request request = new Request.Builder().url(urlString).build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Linux " + label + " download failed with HTTP " + response.code() + ".");
            }
            ResponseBody body = response.body();
            if (body == null) {
                throw new IOException("Linux " + label + " download returned no data.");
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
                        throw new IOException("The Linux " + label + " is too large.");
                    }
                }
            }
        }
        if (!partial.renameTo(destination)) {
            throw new IOException("The Linux " + label + " could not be saved.");
        }
    }

    private boolean copyBundledRootfs(File destination) throws IOException {
        String[] assets = {ASSET_ROOTFS_TAR, ASSET_ROOTFS_GZ};
        String[] checksums = {ALPINE_ROOTFS_TAR_SHA256, ALPINE_ROOTFS_SHA256};

        for (int index = 0; index < assets.length; index++) {
            if (!copyAsset(assets[index], destination)) {
                continue;
            }
            if (matchesSha256(destination, checksums[index])) {
                return true;
            }
            destination.delete();
        }

        return false;
    }

    private static boolean isGzipArchive(File file) throws IOException {
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            int first = input.read();
            int second = input.read();
            return first == 0x1f && second == 0x8b;
        }
    }

    private void extract(File archive, File destination) throws Exception {
        String rootCanonical = destination.getCanonicalPath();
        try (
            InputStream fileInput = new BufferedInputStream(new FileInputStream(archive));
            InputStream content = isGzipArchive(archive)
                ? new GzipCompressorInputStream(fileInput)
                : fileInput;
            TarArchiveInputStream tar = new TarArchiveInputStream(content)
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
                    try {
                        mkdirs(output);
                    } catch (IOException failure) {
                        if (isBindMountedDir(output)) {
                            // proot bind-mounts /dev, /sys and /proc from the
                            // host, so an uncreatable copy is not fatal.
                            Log.w(TAG, "Skipping bind-mounted directory " + name + ": "
                                + failure.getMessage());
                            continue;
                        }
                        throw failure;
                    }
                    applyMode(output, entry);
                    continue;
                }
                if (entry.isSymbolicLink()) {
                    writeSymlink(entry.getLinkName(), output);
                    applyMode(output, entry);
                    continue;
                }
                if (entry.isLink()) {
                    writeHardLink(destination, entry.getLinkName(), output);
                    applyMode(output, entry);
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
                applyMode(output, entry);
            }
        }
    }

    /**
     * Applies the tar entry's unix mode (permissions) through android.system,
     * which is available from API 21. Falls back to basic Java permissions if
     * the syscall is unavailable.
     */
    private void applyMode(File target, TarArchiveEntry entry) {
        int mode = entry.getMode() & 0x7777;
        if (target.isDirectory()) {
            // Extraction must be able to populate subdirectories even if the
            // archive mode is read-only for the owner.
            mode |= 0700;
        }
        try {
            Os.chmod(target.getAbsolutePath(), mode);
        } catch (Exception ignored) {
            // Executable bit fallback for files only.
            if ((mode & 0111) != 0) {
                target.setExecutable(true, false);
            } else {
                target.setReadable(true, false);
            }
        }
    }

    private static boolean entryExists(File file) {
        try {
            Os.lstat(file.getAbsolutePath());
            return true;
        } catch (ErrnoException failure) {
            return false;
        }
    }

    private static boolean isBindMountedDir(File directory) {
        String name = directory.getName();
        return "dev".equals(name) || "proc".equals(name) || "sys".equals(name);
    }

    private void writeSymlink(String target, File link) throws IOException {
        try {
            Os.symlink(target, link.getAbsolutePath());
        } catch (ErrnoException first) {
            if (first.errno != OsConstants.EEXIST) {
                throw new IOException(
                    "Could not create symbolic link " + name(link) + ": " + first.getMessage());
            }
            link.delete();
            try {
                Os.symlink(target, link.getAbsolutePath());
            } catch (ErrnoException second) {
                throw new IOException(
                    "Could not create symbolic link " + name(link) + ": " + second.getMessage());
            }
        }
    }

    private void writeHardLink(File rootfs, String source, File link) throws IOException {
        File origin = new File(rootfs, source);
        String canonicalSource = origin.getCanonicalPath();
        String rootCanonical = rootfs.getCanonicalPath();
        if (!canonicalSource.startsWith(rootCanonical + File.separator)) {
            throw new IOException("The rootfs archive hard-links outside its directory: " + source);
        }
        if (!origin.isFile()) {
            throw new IOException("The rootfs archive hard-links a missing file: " + source);
        }
        if (link.exists()) {
            link.delete();
        }
        try {
            Os.link(origin.getAbsolutePath(), link.getAbsolutePath());
        } catch (ErrnoException failure) {
            // Android SELinux denies hard links inside app-private storage.
            // Copying keeps the extracted rootfs usable; PRoot also emulates
            // later package-install hard links with --link2symlink.
            if (failure.errno == OsConstants.EACCES
                || failure.errno == OsConstants.EPERM
                || failure.errno == OsConstants.EXDEV) {
                copyFile(origin, link);
                return;
            }
            throw new IOException(
                "Could not create hard link " + name(link) + ": " + failure.getMessage());
        }
    }

    private static void copyFile(File source, File destination) throws IOException {
        File parent = destination.getParentFile();
        if (parent != null) {
            mkdirs(parent);
        }
        try (
            InputStream input = new BufferedInputStream(new FileInputStream(source));
            OutputStream output = new FileOutputStream(destination)
        ) {
            byte[] buffer = new byte[128 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        }
    }

    private static String name(File file) {
        return new File(file.getAbsolutePath()).getName();
    }

    private boolean matchesSha256(File file, String expectedHex) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
                byte[] buffer = new byte[128 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    digest.update(buffer, 0, read);
                }
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : digest.digest()) {
                hex.append(String.format(Locale.US, "%02x", b));
            }
            return hex.toString().equals(expectedHex.toLowerCase(Locale.US));
        } catch (Exception failure) {
            return false;
        }
    }

    private boolean copyAsset(String name, File destination) throws IOException {
        try (InputStream input = getContext().getAssets().open(name)) {
            try (OutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[128 * 1024];
                int read;
                long total = 0;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_ROOTFS_BYTES) {
                        throw new IOException("The embedded Linux asset is too large.");
                    }
                    output.write(buffer, 0, read);
                }
            }
            return true;
        } catch (FileNotFoundException missing) {
            return false;
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
        // A leftover file or dangling symlink from an earlier partial
        // extraction would make mkdir fail forever; remove it and retry.
        directory.delete();
        if (directory.mkdirs() || directory.isDirectory()) {
            return;
        }

        // Surface the real cause (EEXIST leftover, EACCES, ENOSPC, EIO...)
        // instead of a generic message.
        String cause;
        try {
            Os.mkdir(directory.getAbsolutePath(), 0777);
            if (directory.isDirectory()) {
                return;
            }
            cause = "the directory still does not exist after mkdir";
        } catch (ErrnoException failure) {
            cause = failure.getMessage();
        }
        File parent = directory.getParentFile();
        throw new IOException(
            "Could not create " + directory.getAbsolutePath() + ": " + cause
                + (parent != null && !parent.canWrite() ? " (its parent is not writable)" : ""));
    }

    private static void deleteRecursively(File file) {
        if (file == null) return;

        // File.exists() follows symlinks, so a dangling link would be invisible
        // and survive deletion, blocking the next extraction (EEXIST). Detect
        // links by comparing the resolved path with the expected child of the
        // resolved parent, and never recurse through them.
        boolean link = false;
        try {
            File parent = file.getParentFile();
            if (parent != null) {
                link = !file.getCanonicalPath().equals(
                    new File(parent.getCanonicalPath(), file.getName()).getPath()
                );
            }
        } catch (IOException failure) {
            link = true;
        }

        if (!link && file.isDirectory()) {
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
