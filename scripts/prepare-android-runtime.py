#!/usr/bin/env python3
"""Prepare the Android-only parts of the embedded OpenCode runtime.

The app downloads the OpenCode runtime on first launch. Android cannot execute
binaries from app-private storage, so the musl loader and PRoot are packaged as
JNI libraries instead. This script extracts the loader from the pinned release,
rewrites its Termux paths for this app, and packages PRoot with its loader and
libraries. It optionally builds the PTY shim.
"""

import argparse
import hashlib
import io
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

TERMUX_PREFIX = "data/data/com.termux/files/usr"
PROOT_DEB_URL = (
    "https://packages.termux.dev/apt/termux-main/pool/main/p/proot/"
    "proot_5.1.107.98_aarch64.deb"
)
PROOT_DEB_SHA256 = "29de40efea4daa2a6168b617915206511c63e8d46bf5f4b07d48723441ef7f3b"
TALLOC_DEB_URL = (
    "https://packages.termux.dev/apt/termux-main/pool/main/libt/libtalloc/"
    "libtalloc_2.5.0_aarch64.deb"
)
TALLOC_DEB_SHA256 = "556591f43bb773ad8777e1a29522640866a55f95dab71914418b94a8c58ad5a7"
SHMEM_DEB_URL = (
    "https://packages.termux.dev/apt/termux-main/pool/main/liba/libandroid-shmem/"
    "libandroid-shmem_0.7_aarch64.deb"
)
SHMEM_DEB_SHA256 = "0da3a24d558b93c92bcf8d611e0826a99ff96e396b148e6cdf33b47c47c57ff6"
PROOT_TERMUX_RUNPATH = b"/data/data/com.termux/files/usr/lib"
PROOT_TERMUX_TALLOC = b"libtalloc.so.2"


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


def ar_member(path, wanted):
    with open(path, "rb") as handle:
        if handle.read(8) != b"!<arch>\n":
            fail(f"{path} is not a Debian package")
        while True:
            header = handle.read(60)
            if not header:
                break
            if len(header) != 60 or header[58:60] != b"`\n":
                fail(f"{path} has an invalid archive member header")
            name = header[0:16].decode("ascii").strip().rstrip("/")
            size_field = header[48:58].decode("ascii").strip()
            try:
                size = int(size_field)
            except ValueError:
                fail(f"{path} has an invalid archive member size")
            data = handle.read(size)
            if len(data) != size:
                fail(f"{path} is truncated")
            if size % 2:
                handle.read(1)
            if name == wanted:
                return data
    fail(f"{path} does not contain {wanted}")


def extract_deb_member(archive, member, destination):
    data = ar_member(archive, "data.tar.xz")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:xz") as tar:
        try:
            source = tar.extractfile(f"./{TERMUX_PREFIX}/{member}")
        except KeyError:
            source = None
        if source is None:
            fail(f"{archive} does not contain {member}")
        with open(destination, "wb") as handle:
            shutil.copyfileobj(source, handle)


def patch_proot(path):
    with open(path, "rb") as handle:
        data = bytearray(handle.read())

    # Keep the dynamic string table offsets intact while letting the linker
    # resolve PRoot's Termux dependencies from the app's nativeLibraryDir.
    replacements = [
        (PROOT_TERMUX_RUNPATH + b"\0", b"$ORIGIN\0"),
        (PROOT_TERMUX_TALLOC + b"\0", b"libtalloc.so\0"),
    ]
    for old, new in replacements:
        count = data.count(old)
        if count != 1:
            fail(f"expected one occurrence of {old!r}, found {count}")
        if len(new) > len(old):
            fail(f"replacement {new!r} is longer than {old!r}")
        start = data.index(old)
        data[start : start + len(old)] = new + b"\0" * (len(old) - len(new))

    with open(path, "wb") as handle:
        handle.write(data)


def prepare_proot(work_dir, sources=None):
    sources = sources or {}
    packages = [
        (
            "proot",
            PROOT_DEB_URL,
            PROOT_DEB_SHA256,
            sources.get("proot"),
        ),
        (
            "libtalloc",
            TALLOC_DEB_URL,
            TALLOC_DEB_SHA256,
            sources.get("libtalloc"),
        ),
        (
            "libandroid-shmem",
            SHMEM_DEB_URL,
            SHMEM_DEB_SHA256,
            sources.get("libandroid-shmem"),
        ),
    ]
    paths = {}

    for name, url, expected, existing in packages:
        archive = existing or os.path.join(work_dir, f"{name}.deb")
        if not existing:
            download(url, archive)
        actual = sha256(archive)
        if actual != expected:
            fail(f"{name} package checksum mismatch: {actual}")
        paths[name] = archive
        print(f"verified {archive}")

    proot = os.path.join(JNI_DIR, "libproot.so")
    loader = os.path.join(JNI_DIR, "libproot_loader.so")
    talloc = os.path.join(JNI_DIR, "libtalloc.so")
    shmem = os.path.join(JNI_DIR, "libandroid-shmem.so")

    extract_deb_member(paths["proot"], "bin/proot", proot)
    extract_deb_member(paths["proot"], "libexec/proot/loader", loader)
    extract_deb_member(paths["libtalloc"], "lib/libtalloc.so.2.5.0", talloc)
    extract_deb_member(
        paths["libandroid-shmem"], "lib/libandroid-shmem.so", shmem
    )
    patch_proot(proot)

    for output in (proot, loader, talloc, shmem):
        os.chmod(output, 0o755)
        print(f"prepared {output}")


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

        prepare_proot(temp)

    if args.ndk:
        build_pty_shim(args.ndk)
    if not args.skip_certificates:
        copy_certificates()


if __name__ == "__main__":
    main()
