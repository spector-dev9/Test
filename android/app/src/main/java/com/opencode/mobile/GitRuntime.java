package com.opencode.mobile;

import android.content.Context;
import android.system.ErrnoException;
import android.system.Os;

import java.io.File;
import java.util.Map;

final class GitRuntime {

    private GitRuntime() {}

    static File executable(Context context) {
        File git = new File(nativeDirectory(context), "libgit.so");
        return git.isFile() ? git : null;
    }

    static File nativeDirectory(Context context) {
        return new File(context.getApplicationInfo().nativeLibraryDir);
    }

    static void applyEnvironment(ProcessBuilder builder, Context context) {
        File files = context.getFilesDir();
        File home = new File(files, "home");
        File temp = new File(context.getCacheDir(), "tmp");
        File templates = new File(files, "git-templates");
        File certificates = new File(files, "runtime/cert.pem");
        File nativeDirectory = nativeDirectory(context);
        File execDirectory = null;

        try {
            execDirectory = execDirectory(context);
        } catch (RuntimeException ignored) {
            // Git stays unavailable, but the OpenCode server can still start.
        }

        mkdirs(home);
        mkdirs(temp);
        mkdirs(templates);

        Map<String, String> environment = builder.environment();
        environment.put("HOME", home.getAbsolutePath());
        environment.put("TMPDIR", temp.getAbsolutePath());
        environment.put("TMP", temp.getAbsolutePath());
        environment.put("TEMP", temp.getAbsolutePath());
        environment.put(
            "PATH",
            (execDirectory == null ? "" : execDirectory.getAbsolutePath() + ":") +
            nativeDirectory.getAbsolutePath() +
            ":/system/bin:/system/xbin:/product/bin:/apex/com.android.runtime/bin"
        );
        environment.put(
            "GIT_EXEC_PATH",
            (execDirectory == null ? nativeDirectory : execDirectory).getAbsolutePath()
        );
        environment.put("GIT_TEMPLATE_DIR", templates.getAbsolutePath());
        environment.put("GIT_TERMINAL_PROMPT", "0");
        environment.put("GIT_CONFIG_NOSYSTEM", "1");
        environment.put("LC_ALL", "C");

        if (certificates.isFile()) {
            environment.put("GIT_SSL_CAINFO", certificates.getAbsolutePath());
        }

        environment.remove("LD_PRELOAD");
    }

    private static synchronized File execDirectory(Context context) {
        File nativeDirectory = nativeDirectory(context);
        File directory = new File(context.getFilesDir(), "git-core");

        mkdirs(directory);

        link(directory, "git", new File(nativeDirectory, "libgit.so"));
        link(
            directory,
            "git-remote-http",
            new File(nativeDirectory, "libgit_remote_http.so")
        );
        link(
            directory,
            "git-remote-https",
            new File(nativeDirectory, "libgit_remote_http.so")
        );
        link(
            directory,
            "git-upload-pack",
            new File(nativeDirectory, "libgit_upload_pack.so")
        );
        link(
            directory,
            "git-receive-pack",
            new File(nativeDirectory, "libgit_receive_pack.so")
        );

        return directory;
    }

    private static void link(File directory, String name, File target) {
        File link = new File(directory, name);

        if (link.exists()) {
            link.delete();
        }

        try {
            Os.symlink(target.getAbsolutePath(), link.getAbsolutePath());
        } catch (ErrnoException failure) {
            if (!link.exists()) {
                throw new IllegalStateException(
                    "The bundled git runtime could not be linked.",
                    failure
                );
            }
        }
    }

    private static void mkdirs(File directory) {
        if (!directory.isDirectory()) {
            directory.mkdirs();
        }
    }
}
