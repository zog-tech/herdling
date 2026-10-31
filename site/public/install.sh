#!/bin/sh
# Installs herdlingd, the companion of the Herdling app, for the current user.
#
#   curl -fsSL https://herdling.zog-tech.com/install.sh | sh
#   curl -fsSL https://herdling.zog-tech.com/install.sh | sh -s -- --version 0.2.0
#   curl -fsSL https://herdling.zog-tech.com/install.sh | sh -s -- --with-herdr
#
# What it does:
#   1. Finds the OS and the CPU. macOS and Linux only.
#   2. Checks that herdr is installed. It installs herdr only with --with-herdr.
#   3. Downloads the herdlingd release from github.com/zog-tech/herdling over HTTPS.
#   4. Compares the SHA-256 of the download with SHA256SUMS of the same release.
#   5. Runs "herdlingd install": copies the binary to ~/.local/bin and starts a user service.
#   6. Tells when the service starts: at boot, or only after the user logs in.
# It never uses sudo. Run it again to update or repair herdlingd.
#
# Options:
#   --version X.Y.Z   install this version, not the latest release
#   --with-herdr      when herdr is missing, first run the official herdr installer
#                     (https://herdr.dev/install.sh). It puts herdr in ~/.local/bin, with no sudo.
#                     herdr is made by its own project, not by Zog Tech.
#   --quiet           print only lines for the Herdling app:
#                       HERDLINGD_STEP <step>
#                       HERDLINGD_BOOT boot|login|unknown (when the service starts)
#                       HERDLINGD_INSTALLED <version>     (success, last line)
#                       HERDLINGD_ERROR <code> <text>     (failure, exit 1)
#   --help            show this text
#
# Source: https://github.com/zog-tech/herdling (MPL-2.0).

set -u

# HERDLING_RELEASE_BASE is for tests only. It points the script at a local copy of a release.
BASE="${HERDLING_RELEASE_BASE:-https://github.com/zog-tech/herdling/releases}"
# HERDR_INSTALL_URL is for tests only. It points --with-herdr at a fake herdr installer.
HERDR_INSTALL_URL="${HERDR_INSTALL_URL:-https://herdr.dev/install.sh}"
VERSION=""
QUIET=0
WITH_HERDR=0
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
    --with-herdr)
      WITH_HERDR=1
      shift
      ;;
    --help | -h)
      echo "Installs herdlingd for the current user."
      echo "usage: install.sh [--version X.Y.Z] [--with-herdr] [--quiet]"
      echo "  --with-herdr  when herdr is missing, install it first with its official installer"
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

find_herdr() {
  command -v herdr >/dev/null 2>&1 && return 0
  for d in "$HOME/.local/bin" "$HOME/.cargo/bin" /opt/homebrew/bin /usr/local/bin /usr/bin; do
    [ -x "$d/herdr" ] && return 0
  done
  return 1
}

# Runs the official herdr installer. Only with --with-herdr: this script never installs
# third-party software unless the user asks for it.
install_herdr() {
  step herdr "Installing herdr with its official installer ($HERDR_INSTALL_URL)..."
  command -v curl >/dev/null 2>&1 ||
    fail no_downloader "The herdr installer needs curl. Install curl, then run this again."
  case "$HERDR_INSTALL_URL" in
    https://*) hs=$(curl -fsSL --proto '=https' --tlsv1.2 --retry 2 "$HERDR_INSTALL_URL") || hs="" ;;
    http://127.0.0.1* | http://localhost*) hs=$(curl -fsSL --retry 2 "$HERDR_INSTALL_URL") || hs="" ;;
    *) fail herdr_install_failed "The herdr installer URL must use HTTPS." ;;
  esac
  # A failed download gives an empty text: never run an empty or half script.
  [ -n "$hs" ] || fail herdr_install_failed "Cannot download the herdr installer from $HERDR_INSTALL_URL."
  if [ "$QUIET" = 1 ]; then
    hout=$(printf '%s\n' "$hs" | sh 2>&1) ||
      fail herdr_install_failed "The herdr installer failed: $(printf '%s\n' "$hout" | awk '{ gsub(/\033\[[0-9;]*m/, ""); print }' | tail -n 3 | tr '\n' ' ')"
  else
    printf '%s\n' "$hs" | sh || fail herdr_install_failed "The herdr installer failed."
  fi
  find_herdr ||
    fail herdr_install_failed "The herdr installer ran, but herdr is not in ~/.local/bin or on the PATH."
}

if ! find_herdr; then
  [ "$WITH_HERDR" = 1 ] ||
    fail no_herdr "herdr is not installed on this computer. Install herdr first (https://herdr.dev), or run this again with --with-herdr."
  install_herdr
fi

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

# When the user service starts: "boot", "login" or "unknown". It only reads; it changes nothing.
boot_state() {
  me=$(id -un 2>/dev/null || echo "${USER:-}")
  if [ "$os" = Darwin ]; then
    case "$(/usr/bin/fdesetup status 2>/dev/null)" in
      *"FileVault is On"* | *"will be enabled"* | *"Encryption in progress"*) echo login; return ;;
    esac
    auto=$(/usr/bin/defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null) || auto=""
    if [ -n "$me" ] && [ "$auto" = "$me" ]; then echo boot; else echo login; fi
    return
  fi
  if command -v loginctl >/dev/null 2>&1; then
    case "$(loginctl show-user "$me" -p Linger 2>/dev/null)" in
      *Linger=yes*) echo boot; return ;;
      *Linger=no*) echo login; return ;;
    esac
  fi
  if [ -n "$me" ] && [ -e "/var/lib/systemd/linger/$me" ]; then echo boot; else echo unknown; fi
}
# HERDLING_BOOT_STATE is for tests only. It replaces the check of this computer.
boot=${HERDLING_BOOT_STATE:-$(boot_state)}

if [ "$QUIET" = 1 ]; then
  printf 'HERDLINGD_BOOT %s\n' "$boot"
  printf 'HERDLINGD_INSTALLED %s\n' "$installed"
else
  say ""
  say "herdlingd $installed is installed in $bin and runs as a user service."
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) say "Add ~/.local/bin to your PATH to run herdlingd from a terminal." ;;
  esac
  say ""
  if [ "$boot" = boot ]; then
    say "herdlingd starts when this computer starts."
  elif [ "$os" = Darwin ]; then
    say "herdlingd starts when you log in on this Mac. To start it at boot, with no login:"
    say "  System Settings > Users & Groups > Automatically log in as > $(id -un 2>/dev/null || echo 'your user')."
    say "  This is not possible while FileVault is on. Then log in once after each restart."
  else
    say "herdlingd starts when you log in on this computer. To start it at boot, with no login, run once:"
    say "  sudo loginctl enable-linger $(id -un 2>/dev/null || echo '$USER')"
  fi
  say "herdr must run too. Start it in a terminal with: herdr"
  say ""
  say "Next: open Herdling on your phone and add this computer, or run: $bin pair"
fi
