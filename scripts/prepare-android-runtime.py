#!/usr/bin/env python3
"""Prepare the Android-only parts of the embedded OpenCode runtime.

The app downloads the OpenCode runtime on first launch. Android cannot execute
binaries from app-private storage, so the musl loader is packaged as a JNI
library instead. This script extracts that loader from the pinned release,
rewrites its Termux paths for this app, and optionally builds the PTY shim.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META_PATH = os.path.join(
    ROOT, "android", "app", "src", "main", "assets", "runtime.json"
)
JNI_DIR = os.path.join(
    ROOT, "android", "app", "src", "main", "jniLibs", "arm64-v8a"
)
ASSET_DIR = os.path.join(ROOT, "android", "app", "src", "main", "assets")
PTY_SOURCE = os.path.join(ROOT, "android", "app", "src", "main", "cpp", "librust_pty.c")


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def load_meta():
    with open(META_PATH, "r", encoding="utf-8") as handle:
        meta = json.load(handle)
    for key in (
        "url",
        "sha256",
        "loader",
        "termuxPrefix",
        "termuxResolver",
        "androidPrefix",
        "androidResolver",
    ):
        if not isinstance(meta.get(key), str) or not meta[key]:
            fail(f"runtime.json is missing {key}")
    if not meta["androidPrefix"].startswith("/"):
        fail("androidPrefix must be absolute")
    if len(meta["androidPrefix"].encode()) != len(meta["termuxPrefix"].encode()):
        fail("androidPrefix must have the same byte length as termuxPrefix")
    if len(meta["androidResolver"].encode()) > len(meta["termuxResolver"].encode()):
        fail("androidResolver must not be longer than termuxResolver")
    return meta


def download(url, destination):
    print(f"downloading {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "opencode-mobile"})
    with urllib.request.urlopen(request, timeout=300) as response:
        with open(destination, "wb") as handle:
            shutil.copyfileobj(response, handle)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def replace_once(data, old, new):
    old_bytes = old.encode()
    new_bytes = new.encode()
    if len(new_bytes) > len(old_bytes):
        fail(f"replacement {new!r} is longer than {old!r}")
    count = data.count(old_bytes)
    if count != 1:
        fail(f"expected one occurrence of {old!r}, found {count}")
    start = data.index(old_bytes)
    data[start : start + len(old_bytes)] = new_bytes + b"\0" * (
        len(old_bytes) - len(new_bytes)
    )


def patch_loader(path, meta):
    with open(path, "rb") as handle:
        data = bytearray(handle.read())
    replace_once(data, meta["termuxResolver"], meta["androidResolver"])
    if meta["termuxPrefix"] in data.decode("latin-1"):
        replace_once(data, meta["termuxPrefix"], meta["androidPrefix"].rstrip("/"))
    with open(path, "wb") as handle:
        handle.write(data)


def extract_loader(archive, meta, destination):
    with tarfile.open(archive, "r:gz") as tar:
        member = tar.getmember(meta["loader"])
        source = tar.extractfile(member)
        if source is None:
            fail(f"archive does not contain {meta['loader']}")
        with open(destination, "wb") as handle:
            shutil.copyfileobj(source, handle)


def build_pty_shim(ndk):
    compiler = os.path.join(
        ndk,
        "toolchains",
        "llvm",
        "prebuilt",
        "linux-x86_64",
        "bin",
        "aarch64-linux-android24-clang",
    )
    if not os.path.isfile(compiler):
        fail(f"NDK compiler not found at {compiler}")
    output = os.path.join(JNI_DIR, "librust_pty_bionic.so")
    subprocess.run(
        [
            compiler,
            "-shared",
            "-fPIC",
            "-O2",
            "-nostartfiles",
            "-Wall",
            "-Wextra",
            "-Wl,-z,max-page-size=16384",
            "-o",
            output,
            PTY_SOURCE,
        ],
        check=True,
    )
    os.chmod(output, 0o755)
    print(f"built {output}")


def copy_certificates():
    sources = [
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/ssl/cert.pem",
    ]
    for source in sources:
        if os.path.isfile(source):
            destination = os.path.join(ASSET_DIR, "runtime", "cert.pem")
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            shutil.copyfile(source, destination)
            print(f"copied {source} to {destination}")
            return
    fail("no CA bundle found on the build host")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ndk", help="Android NDK directory for the PTY shim")
    parser.add_argument("--archive", help="Use an existing release archive")
    parser.add_argument(
        "--skip-certificates", action="store_true", help="Do not copy a CA bundle"
    )
    args = parser.parse_args()

    meta = load_meta()
    os.makedirs(JNI_DIR, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="opencode-runtime-") as temp:
        archive = args.archive or os.path.join(temp, "release.tar.gz")
        if not args.archive:
            download(meta["url"], archive)
        actual = sha256(archive)
        if actual != meta["sha256"]:
            fail(f"archive checksum mismatch: {actual}")
        print(f"verified {archive}")

        loader = os.path.join(JNI_DIR, "libopencode_loader.so")
        extract_loader(archive, meta, loader)
        patch_loader(loader, meta)
        os.chmod(loader, 0o755)
        print(f"patched loader {loader}")

    if args.ndk:
        build_pty_shim(args.ndk)
    if not args.skip_certificates:
        copy_certificates()


if __name__ == "__main__":
    main()
