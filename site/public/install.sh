#!/bin/sh
# Installs herdlingd, the companion of the Herdling app, for the current user.
#
#   curl -fsSL https://herdling.zog-tech.com/install.sh | sh
#   curl -fsSL https://herdling.zog-tech.com/install.sh | sh -s -- --version 0.2.0
#
# What it does:
#   1. Finds the OS and the CPU. macOS and Linux only.
#   2. Checks that herdr is installed. It does not install herdr.
#   3. Downloads the herdlingd release from github.com/zog-tech/herdling over HTTPS.
#   4. Compares the SHA-256 of the download with SHA256SUMS of the same release.
#   5. Runs "herdlingd install": copies the binary to ~/.local/bin and starts a user service.
# It never uses sudo. Run it again to update or repair herdlingd.
#
# Options:
#   --version X.Y.Z   install this version, not the latest release
#   --quiet           print only lines for the Herdling app:
#                       HERDLINGD_STEP <step>
#                       HERDLINGD_INSTALLED <version>     (success, last line)
#                       HERDLINGD_ERROR <code> <text>     (failure, exit 1)
#   --help            show this text
#
# Source: https://github.com/zog-tech/herdling (MPL-2.0).

set -u

# HERDLING_RELEASE_BASE is for tests only. It points the script at a local copy of a release.
BASE="${HERDLING_RELEASE_BASE:-https://github.com/zog-tech/herdling/releases}"
VERSION=""
QUIET=0
TMP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || { echo "error: --version needs a value" >&2; exit 2; }
      VERSION="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#--version=}"
      shift
      ;;
    --quiet | -q)
      QUIET=1
      shift
      ;;
    --help | -h)
      echo "Installs herdlingd for the current user."
      echo "usage: install.sh [--version X.Y.Z] [--quiet]"
      echo "Details: https://herdling.zog-tech.com/docs"
      exit 0
      ;;
    *)
      echo "error: unknown option $1" >&2
      exit 2
      ;;
  esac
done

say() {
  [ "$QUIET" = 1 ] || printf '%s\n' "$*"
}

step() {
  if [ "$QUIET" = 1 ]; then
    printf 'HERDLINGD_STEP %s\n' "$1"
  else
    printf '%s\n' "$2"
  fi
}

cleanup() {
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 1' INT TERM

# fail <code> <text>: stops the script.
fail() {
  if [ "$QUIET" = 1 ]; then
    printf 'HERDLINGD_ERROR %s %s\n' "$1" "$2"
  else
    printf 'error: %s\n' "$2" >&2
  fi
  exit 1
}

case "$VERSION" in
  "" | [0-9]*.[0-9]*.[0-9]*) ;;
  *) fail download_failed "The version must look like 1.2.3, not $VERSION." ;;
esac
case "$VERSION" in
  *[!0-9A-Za-z.-]*) fail download_failed "The version must look like 1.2.3, not $VERSION." ;;
esac

step check "Checking this computer..."

os=$(uname -s 2>/dev/null || echo unknown)
arch=$(uname -m 2>/dev/null || echo unknown)
case "$os" in
  Darwin) os_part=apple-darwin ;;
  Linux) os_part=unknown-linux-musl ;;
  MINGW* | MSYS* | CYGWIN* | Windows*)
    fail unsupported_os "Windows is not supported. herdlingd runs on macOS and Linux." ;;
  *) fail unsupported_os "$os is not supported. herdlingd runs on macOS and Linux." ;;
esac
case "$arch" in
  arm64 | aarch64) arch_part=aarch64 ;;
  x86_64 | amd64) arch_part=x86_64 ;;
  *) fail unsupported_arch "The CPU type $arch is not supported. herdlingd runs on arm64 and x86_64." ;;
esac
# A shell under Rosetta reports x86_64 on an Apple silicon Mac. Use the native build.
if [ "$os" = Darwin ] && [ "$arch_part" = x86_64 ]; then
  if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch_part=aarch64
  fi
fi
target="$arch_part-$os_part"

[ -n "${HOME:-}" ] || fail install_failed "HOME is not set."

herdr_found=""
if command -v herdr >/dev/null 2>&1; then
  herdr_found=1
else
  for d in "$HOME/.local/bin" "$HOME/.cargo/bin" /opt/homebrew/bin /usr/local/bin /usr/bin; do
    if [ -x "$d/herdr" ]; then
      herdr_found=1
      break
    fi
  done
fi
[ -n "$herdr_found" ] ||
  fail no_herdr "herdr is not installed on this computer. Install herdr first (https://herdr.dev), then run this again."

if command -v curl >/dev/null 2>&1; then
  dl() { curl -fsSL --proto '=https' --tlsv1.2 --retry 2 -o "$2" "$1"; }
  # A test base on localhost uses plain HTTP.
  case "$BASE" in
    http://127.0.0.1* | http://localhost*) dl() { curl -fsSL --retry 2 -o "$2" "$1"; } ;;
  esac
elif command -v wget >/dev/null 2>&1; then
  dl() { wget -q -O "$2" "$1"; }
else
  fail no_downloader "Neither curl nor wget is installed. Install one of them, then run this again."
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  fail no_checksum_tool "Neither sha256sum nor shasum is installed, so the download cannot be checked."
fi

command -v tar >/dev/null 2>&1 || fail install_failed "tar is not installed."

if [ -n "$VERSION" ]; then
  url="$BASE/download/herdlingd-v$VERSION"
  what="herdlingd $VERSION"
else
  url="$BASE/latest/download"
  what="the latest herdlingd"
fi
file="herdlingd-$target.tar.gz"

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t herdlingd) || fail install_failed "Cannot make a temporary folder."

step download "Downloading $what for $target..."
dl "$url/$file" "$TMP/$file" || fail download_failed "Cannot download $url/$file. Check the network and the version."
dl "$url/SHA256SUMS" "$TMP/SHA256SUMS" || fail download_failed "Cannot download $url/SHA256SUMS."

step verify "Checking the SHA-256..."
expected=$(awk -v f="$file" '$2 == f || $2 == "*" f { print $1; exit }' "$TMP/SHA256SUMS")
[ -n "$expected" ] || fail checksum_mismatch "SHA256SUMS has no line for $file."
actual=$(sha256 "$TMP/$file")
[ "$actual" = "$expected" ] ||
  fail checksum_mismatch "The download of $file does not match SHA256SUMS. Nothing was installed."

step install "Installing herdlingd..."
mkdir "$TMP/x" && tar -xzf "$TMP/$file" -C "$TMP/x" herdlingd ||
  fail install_failed "Cannot unpack $file."
chmod 0755 "$TMP/x/herdlingd"
if [ "$QUIET" = 1 ]; then
  out=$("$TMP/x/herdlingd" install 2>&1) ||
    fail install_failed "herdlingd install failed: $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')"
else
  "$TMP/x/herdlingd" install || fail install_failed "herdlingd install failed."
fi

bin="$HOME/.local/bin/herdlingd"
installed=$("$bin" version 2>/dev/null) || installed=""
[ -n "$installed" ] || fail install_failed "$bin does not run after the install."

if [ "$QUIET" = 1 ]; then
  printf 'HERDLINGD_INSTALLED %s\n' "$installed"
else
  say ""
  say "herdlingd $installed is installed in $bin and runs as a user service."
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) say "Add ~/.local/bin to your PATH to run herdlingd from a terminal." ;;
  esac
  say "Next: open Herdling on your phone and add this computer, or run: $bin pair"
fi
