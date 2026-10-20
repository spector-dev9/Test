#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/android/app/src/main/jniLibs/arm64-v8a"

if [ ! -x "$PREFIX/bin/git" ]; then
  echo "Termux git is required to generate the bundled runtime." >&2
  exit 1
fi

if ! command -v patchelf >/dev/null 2>&1; then
  echo "patchelf is required to generate the bundled runtime." >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"

copy_binary() {
  local source="$1" destination="$2" origin="$3"
  cp "$source" "$destination"
  chmod 755 "$destination"
  patchelf --set-rpath "$origin" "$destination"
  patchelf --replace-needed libz.so.1 libz.so "$destination" 2>/dev/null || true
  patchelf --replace-needed libcrypto.so.3 libcrypto.so "$destination" 2>/dev/null || true
  patchelf --replace-needed libssl.so.3 libssl.so "$destination" 2>/dev/null || true
  patchelf --replace-needed libexpat.so.1 libexpat.so "$destination" 2>/dev/null || true
}

# Android only extracts lib*.so files from the APK into nativeLibraryDir.
copy_binary "$PREFIX/bin/git" "$OUT/libgit.so" '$ORIGIN'
copy_binary "$PREFIX/libexec/git-core/git-remote-http" "$OUT/libgit_remote_http.so" '$ORIGIN'
copy_binary "$PREFIX/libexec/git-core/git-upload-pack" "$OUT/libgit_upload_pack.so" '$ORIGIN'
copy_binary "$PREFIX/libexec/git-core/git-receive-pack" "$OUT/libgit_receive_pack.so" '$ORIGIN'

copy_library() {
  local source="$1" name="$2"
  cp "$PREFIX/lib/$source" "$OUT/$name"
  chmod 755 "$OUT/$name"
  patchelf --set-rpath '$ORIGIN' "$OUT/$name"
  patchelf --set-soname "$name" "$OUT/$name"
  patchelf --replace-needed libz.so.1 libz.so "$OUT/$name" 2>/dev/null || true
  patchelf --replace-needed libcrypto.so.3 libcrypto.so "$OUT/$name" 2>/dev/null || true
  patchelf --replace-needed libssl.so.3 libssl.so "$OUT/$name" 2>/dev/null || true
  patchelf --replace-needed libexpat.so.1 libexpat.so "$OUT/$name" 2>/dev/null || true
}

copy_library libpcre2-8.so libpcre2-8.so
copy_library libz.so.1.3.2 libz.so
copy_library libiconv.so libiconv.so
copy_library libcrypto.so.3 libcrypto.so
copy_library libssl.so.3 libssl.so
copy_library libcurl.so libcurl.so
copy_library libnghttp3.so libnghttp3.so
copy_library libngtcp2.so libngtcp2.so
copy_library libngtcp2_crypto_ossl.so libngtcp2_crypto_ossl.so
copy_library libnghttp2.so libnghttp2.so
copy_library libssh2.so libssh2.so

echo "Prepared bundled git runtime in $OUT"
