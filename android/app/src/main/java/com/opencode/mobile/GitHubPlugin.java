package com.opencode.mobile;

import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "GitHub")
public class GitHubPlugin extends Plugin {

    private static final int MAX_OUTPUT_CHARS = 20000;
    private static final int MAX_CHANGES = 200;
    private static final long PROCESS_TIMEOUT_MINUTES = 10;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void status(PluginCall call) {
        String directory = call.getString("directory");
        File repository = resolveDirectory(directory);

        if (repository == null) {
            call.reject("The repository directory is invalid.");
            return;
        }

        executor.execute(() -> {
            try {
                finish(call, repositoryStatus(repository));
            } catch (Exception failure) {
                reject(call, failure, null);
            }
        });
    }

    @PluginMethod
    public void cloneRepository(PluginCall call) {
        String rawUrl = call.getString("url");
        String destination = call.getString("destination");
        String token = normalizeToken(call.getString("token"));
        String branch = call.getString("branch");

        URI uri;

        try {
            uri = requireHttpsUri(rawUrl);
        } catch (Exception failure) {
            call.reject("Enter a valid HTTPS repository URL.");
            return;
        }

        if (branch != null && !isValidBranch(branch)) {
            call.reject("The branch name is invalid.");
            return;
        }

        File target = resolveDestination(destination);
        if (target == null) {
            call.reject("The clone destination is invalid.");
            return;
        }

        executor.execute(() -> {
            try {
                File parent = target.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                    reject(call, "The clone destination could not be created.", token);
                    return;
                }

                if (target.exists()) {
                    String[] children = target.list();

                    if (!target.isDirectory() || (children != null && children.length > 0)) {
                        reject(call, "The clone destination already exists and is not empty.", token);
                        return;
                    }
                }

                List<String> arguments = new ArrayList<>();
                arguments.add("clone");

                if (branch != null && !branch.trim().isEmpty()) {
                    arguments.add("--branch");
                    arguments.add(branch.trim());
                }

                arguments.add(authenticatedUrl(uri.toString(), token));
                arguments.add(target.getAbsolutePath());

                ProcessResult clone = runGit(null, arguments);

                if (clone.exitCode != 0) {
                    reject(call, clone.output, token);
                    return;
                }

                ProcessResult reset = runGit(target, Arrays.asList(
                    "remote",
                    "set-url",
                    "origin",
                    uri.toString()
                ));

                if (reset.exitCode != 0) {
                    reject(call, reset.output, token);
                    return;
                }

                JSObject result = repositoryStatus(target);
                result.put("path", target.getAbsolutePath());
                result.put("name", target.getName());
                result.put("output", sanitize(clone.output, token));
                finish(call, result);
            } catch (Exception failure) {
                reject(call, failure, token);
            }
        });
    }

    @PluginMethod
    public void commitAndPush(PluginCall call) {
        String directory = call.getString("directory");
        String message = call.getString("message");
        String token = normalizeToken(call.getString("token"));
        String authorName = call.getString("name");
        String authorEmail = call.getString("email");
        File repository = resolveDirectory(directory);

        if (repository == null) {
            call.reject("The repository directory is invalid.");
            return;
        }

        if (message == null || message.trim().isEmpty() || message.length() > 500) {
            call.reject("Enter a commit message of up to 500 characters.");
            return;
        }

        if (token == null || token.isEmpty()) {
            call.reject("A repository token is required to push.");
            return;
        }

        String name = authorName == null || authorName.trim().isEmpty()
            ? "OpenCode Mobile"
            : authorName.trim().substring(0, Math.min(80, authorName.trim().length()));
        String email = authorEmail == null || authorEmail.trim().isEmpty()
            ? "opencode-mobile@users.noreply.github.com"
            : authorEmail.trim().substring(0, Math.min(200, authorEmail.trim().length()));

        if (!email.contains("@")) {
            call.reject("The commit email is invalid.");
            return;
        }

        executor.execute(() -> {
            try {
                ProcessResult status = runGit(repository, Arrays.asList(
                    "status",
                    "--porcelain=v1"
                ));

                if (status.exitCode != 0) {
                    reject(call, status.output, token);
                    return;
                }

                boolean committed = !status.output.trim().isEmpty();

                if (committed) {
                    ProcessResult add = runGit(repository, Arrays.asList("add", "--all"));

                    if (add.exitCode != 0) {
                        reject(call, add.output, token);
                        return;
                    }

                    ProcessResult commit = runGit(repository, Arrays.asList(
                        "-c",
                        "user.name=" + name,
                        "-c",
                        "user.email=" + email,
                        "commit",
                        "-m",
                        message.trim()
                    ));

                    if (commit.exitCode != 0) {
                        reject(call, commit.output, token);
                        return;
                    }
                }

                ProcessResult branchResult = runGit(repository, Arrays.asList(
                    "symbolic-ref",
                    "--short",
                    "HEAD"
                ));

                if (branchResult.exitCode != 0 || branchResult.output.trim().isEmpty()) {
                    reject(call, "The repository is not on a branch.", token);
                    return;
                }

                String branch = branchResult.output.trim();

                if (!isValidBranch(branch)) {
                    reject(call, "The current branch name is not supported.", token);
                    return;
                }

                ProcessResult remoteResult = runGit(repository, Arrays.asList(
                    "config",
                    "--get",
                    "remote.origin.url"
                ));

                if (remoteResult.exitCode != 0) {
                    reject(call, "The repository has no origin remote.", token);
                    return;
                }

                URI remote = requireHttpsUri(remoteResult.output.trim());
                ProcessResult push = runGit(repository, Arrays.asList(
                    "push",
                    authenticatedUrl(remote.toString(), token),
                    "HEAD:refs/heads/" + branch
                ));

                if (push.exitCode != 0) {
                    reject(call, push.output, token);
                    return;
                }

                JSObject result = new JSObject();
                result.put("committed", committed);
                result.put("pushed", true);
                result.put("branch", branch);
                result.put("output", sanitize(push.output, token));
                finish(call, result);
            } catch (Exception failure) {
                reject(call, failure, token);
            }
        });
    }

    private JSObject repositoryStatus(File repository) throws Exception {
        JSObject result = new JSObject();
        result.put("isRepo", false);

        ProcessResult inside = runGit(repository, Arrays.asList(
            "rev-parse",
            "--is-inside-work-tree"
        ));

        if (inside.exitCode != 0 || !"true".equals(inside.output.trim())) {
            return result;
        }

        result.put("isRepo", true);

        ProcessResult branch = runGit(repository, Arrays.asList(
            "symbolic-ref",
            "--short",
            "HEAD"
        ));
        result.put("branch", branch.exitCode == 0 ? branch.output.trim() : "");

        ProcessResult remote = runGit(repository, Arrays.asList(
            "config",
            "--get",
            "remote.origin.url"
        ));
        result.put("remote", remote.exitCode == 0 ? remote.output.trim() : "");

        ProcessResult changes = runGit(repository, Arrays.asList(
            "status",
            "--porcelain=v1"
        ));
        List<String> lines = new ArrayList<>();

        for (String line : changes.output.split("\n")) {
            if (line.trim().isEmpty()) continue;
            lines.add(line);
            if (lines.size() >= MAX_CHANGES) break;
        }

        JSArray files = new JSArray();

        for (String line : lines) {
            files.put(line);
        }

        result.put("changes", lines.size());
        result.put("files", files);
        return result;
    }

    private ProcessResult runGit(File directory, List<String> arguments)
        throws IOException, InterruptedException {
        File git = GitRuntime.executable(getContext());

        if (git == null) {
            throw new IOException("The bundled git runtime is unavailable.");
        }

        List<String> command = new ArrayList<>();
        command.add(git.getAbsolutePath());
        command.add("-c");
        command.add("credential.helper=");
        command.add("-c");
        command.add("safe.directory=*");
        command.addAll(arguments);

        ProcessBuilder builder = new ProcessBuilder(command);

        if (directory != null) {
            builder.directory(directory);
        }

        builder.redirectErrorStream(true);
        GitRuntime.applyEnvironment(builder, getContext());
        Process process = builder.start();
        process.getOutputStream().close();

        AtomicBoolean timedOut = new AtomicBoolean(false);
        Thread watchdog = new Thread(() -> {
            long deadline =
                System.currentTimeMillis() +
                TimeUnit.MINUTES.toMillis(PROCESS_TIMEOUT_MINUTES);

            while (System.currentTimeMillis() < deadline) {
                try {
                    process.exitValue();
                    return;
                } catch (IllegalThreadStateException running) {
                    // The process is still running.
                }

                try {
                    Thread.sleep(250);
                } catch (InterruptedException interrupted) {
                    process.destroy();
                    return;
                }
            }

            timedOut.set(true);
            process.destroy();
        }, "git-watchdog");
        watchdog.setDaemon(true);
        watchdog.start();

        StringBuilder output = new StringBuilder();

        try (
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8)
            )
        ) {
            String line;

            while ((line = reader.readLine()) != null) {
                if (output.length() < MAX_OUTPUT_CHARS) {
                    output.append(line).append('\n');
                }
            }
        }

        process.waitFor();
        watchdog.interrupt();

        if (timedOut.get()) {
            throw new IOException("The git operation timed out.");
        }

        return new ProcessResult(process.exitValue(), output.toString().trim());
    }

    private void finish(PluginCall call, JSObject result) {
        if (getBridge() == null) return;
        getBridge().executeOnMainThread(() -> call.resolve(result));
    }

    private void reject(PluginCall call, Exception failure, String token) {
        String message = failure.getMessage();

        if (message == null || message.trim().isEmpty()) {
            message = "The git operation failed.";
        }

        reject(call, message, token);
    }

    private void reject(PluginCall call, String output, String token) {
        String message = sanitize(output, token);

        if (message == null || message.trim().isEmpty()) {
            message = "The git operation failed.";
        }

        if (message.length() > 2000) {
            message = message.substring(message.length() - 2000);
        }

        String finalMessage = message;

        if (getBridge() == null) return;
        getBridge().executeOnMainThread(() -> call.reject(finalMessage));
    }

    private static String sanitize(String value, String token) {
        if (value == null) return "";
        String result = value;

        if (token != null && !token.isEmpty()) {
            result = result.replace(token, "***");
            result = result.replace(Uri.encode(token), "***");
        }

        return result;
    }

    private static String normalizeToken(String token) {
        if (token == null) return null;
        String trimmed = token.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static URI requireHttpsUri(String value) throws Exception {
        if (value == null) throw new IllegalArgumentException("Missing URL");
        URI uri = new URI(value.trim());

        if (
            !"https".equalsIgnoreCase(uri.getScheme()) ||
            uri.getHost() == null ||
            uri.getHost().isEmpty() ||
            uri.getUserInfo() != null ||
            uri.toString().length() > 2000
        ) {
            throw new IllegalArgumentException("Invalid URL");
        }

        return uri;
    }

    private static boolean isValidBranch(String branch) {
        if (branch == null || branch.length() > 200) return false;
        if (branch.contains("..")) return false;
        return branch.matches("^[A-Za-z0-9._/-]+$");
    }

    private File resolveDirectory(String value) {
        if (value == null) return null;

        try {
            File directory = new File(value).getCanonicalFile();
            return directory.isDirectory() ? directory : null;
        } catch (IOException failure) {
            return null;
        }
    }

    private File resolveDestination(String value) {
        if (value == null || value.length() > 4096) return null;

        try {
            File directory = new File(value).getCanonicalFile();
            return directory.getParentFile() != null ? directory : null;
        } catch (IOException failure) {
            return null;
        }
    }

    private static String authenticatedUrl(String url, String token) throws Exception {
        if (token == null || token.isEmpty()) return url;

        URI uri = new URI(url);
        return new URI(
            uri.getScheme(),
            "x-access-token:" + Uri.encode(token),
            uri.getHost(),
            uri.getPort(),
            uri.getPath(),
            uri.getQuery(),
            uri.getFragment()
        ).toString();
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
