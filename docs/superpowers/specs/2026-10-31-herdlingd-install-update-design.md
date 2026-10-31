# herdlingd install and update from the phone

Date: 2026-10-31. Status: decided.

## Goal

1. A new user who has herdr but no `herdlingd` sets up a computer from the phone only. The user
   enters the host, the user name and the SSH password. The app installs `herdlingd`, then pairs.
   The user confirms one "Install and pair" step. No terminal on the computer.
2. The app tells the user when `herdlingd` on a host is out of date. One tap updates it.
3. A release pipeline makes prebuilt `herdlingd` binaries. Users do not need Rust.

## Parts

| Part | Where | What it does |
|---|---|---|
| Release workflow | `.github/workflows/release-herdlingd.yml` | Builds four targets on a `herdlingd-v*` tag and publishes a GitHub Release |
| Installer script | `site/public/install.sh` | POSIX `sh`. Downloads, checks and installs the release for this computer |
| Update RPC | `companion/src/update.rs`, `rpc.rs` | `update.check` and `update.apply`, and the CLI `herdlingd update` |
| App: install during setup | `app/src/hosts/passwordSetup.ts`, `app/src/app/hosts/password.tsx` | Runs the installer over the password SSH login, then enrolls |
| App: update prompt | `app/src/hosts/updates.ts` and the host screens | Shows "Update available" and calls `update.apply` |

## A. Release assets

A tag `herdlingd-vX.Y.Z` starts the workflow. The workflow stops when `X.Y.Z` is not the
`version` in `companion/Cargo.toml`.

Targets (Linux builds are static musl binaries, so they run on every distribution):

| Target | Runner |
|---|---|
| `aarch64-apple-darwin` | macOS runner |
| `x86_64-apple-darwin` | macOS runner (cross target) |
| `x86_64-unknown-linux-musl` | Ubuntu runner with `cross` |
| `aarch64-unknown-linux-musl` | Ubuntu runner with `cross` |

Assets of each release:

- `herdlingd-<target>.tar.gz`. It holds `herdlingd` and `LICENSE` at the top level.
- `SHA256SUMS`. One `<sha256>  <file name>` line for each tarball (the `sha256sum` format).
- `latest.json`:

```json
{
  "version": "0.2.0",
  "date": "2026-11-02",
  "notes": "Text of the CHANGELOG section for this version.",
  "assets": {
    "aarch64-apple-darwin": {
      "url": "https://github.com/zog-tech/herdling/releases/download/herdlingd-v0.2.0/herdlingd-aarch64-apple-darwin.tar.gz",
      "sha256": "<64 hex digits>"
    }
  }
}
```

The workflow marks the release as "latest". So these URLs always point to the newest release:

- `https://github.com/zog-tech/herdling/releases/latest/download/latest.json`
- `https://github.com/zog-tech/herdling/releases/latest/download/SHA256SUMS`
- `https://github.com/zog-tech/herdling/releases/latest/download/herdlingd-<target>.tar.gz`

A pinned version uses `https://github.com/zog-tech/herdling/releases/download/herdlingd-vX.Y.Z/<file>`.
Other releases in this repository (for example app releases) must not be marked "latest".

## B. Installer script

`https://herdling.zog-tech.com/install.sh`, served as `text/plain`.

```sh
curl -fsSL https://herdling.zog-tech.com/install.sh | sh
curl -fsSL https://herdling.zog-tech.com/install.sh | sh -s -- --version 0.2.0 --quiet
```

Steps:

1. Find the OS (`uname -s`: Darwin or Linux) and the CPU (`uname -m`: arm64, aarch64, x86_64).
   Windows (MINGW, MSYS, CYGWIN) and other systems stop with `unsupported_os`.
2. Find herdr (`command -v herdr`, then `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`,
   `/usr/local/bin`). When herdr is missing, the script stops and links https://herdr.dev.
   The script does not install herdr, unless the user gives `--with-herdr` (added after 0.1.0):
   then it downloads the official herdr installer `https://herdr.dev/install.sh` into a variable,
   runs it (it puts `herdr` in `~/.local/bin`, with no sudo and no login service), and finds
   herdr again. The app passes `--with-herdr` only after the user taps "Install herdr and herdlingd".
3. Find `curl` or `wget`, and `shasum` or `sha256sum`.
4. Download the tarball and `SHA256SUMS` into a new temporary folder. The script uses the files
   directly and does not parse `latest.json` (no `jq` is necessary).
5. Compare the SHA-256 of the tarball with its line in `SHA256SUMS`. A difference stops the script.
6. Unpack and run `<temp>/herdlingd install`. That command copies the binary to
   `~/.local/bin/herdlingd` and starts the user service (launchd or systemd).
7. Print the version from `~/.local/bin/herdlingd version`. Remove the temporary folder.

No `sudo`. A second run installs the same or a newer binary again and restarts the service.

Flags: `--version X.Y.Z`, `--with-herdr`, `--quiet`, `--help`. `HERDLING_RELEASE_BASE` replaces
`https://github.com/zog-tech/herdling/releases` for tests only. `HERDR_INSTALL_URL` replaces the
herdr installer URL, and `HERDLING_BOOT_STATE` replaces the boot check, for tests only.

`--quiet` output for the app. Each line starts with a fixed word:

| Line | Meaning |
|---|---|
| `HERDLINGD_STEP <step>` | Progress: `check`, `herdr` (only with `--with-herdr`), `download`, `verify`, `install` |
| `HERDLINGD_BOOT <state>` | When the user service starts: `boot`, `login` or `unknown`. Just before `HERDLINGD_INSTALLED`. An older script does not print it |
| `HERDLINGD_INSTALLED <version>` | Success. The last line. Exit 0 |
| `HERDLINGD_ERROR <code> <text>` | Failure. Exit 1 |

Error codes: `unsupported_os`, `unsupported_arch`, `no_herdr`, `herdr_install_failed`,
`no_downloader`, `no_checksum_tool`, `download_failed`, `checksum_mismatch`, `install_failed`.

## C. Update RPC

The phone key is restricted: `command="<exe> rpc"`. So the phone cannot run the installer with
its key. The update runs inside `herdlingd rpc`.

### `update.check`

Params: `{ version?: string }`. Result:

```ts
type UpdateCheck = {
  current: string;          // CARGO_PKG_VERSION of the running herdlingd
  latest: string;           // version in the manifest
  update_available: boolean;// latest > current
  notes: string;
  date?: string;
  target: string;           // the asset target for this computer
};
```

### `update.apply`

Params: `{ version?: string; allow_downgrade?: boolean }`. Result:

```ts
type UpdateApply = {
  from: string;
  to: string;
  status: "updated" | "up_to_date";
  /** False when no service is installed, or when the restart command failed. */
  service_restarted: boolean;
};
```

Steps:

1. Get the manifest (`latest.json` of the latest release, or of `herdlingd-v<version>`).
2. Pick the asset for this computer from `std::env::consts::{OS, ARCH}`. Linux always uses the musl asset.
3. Same version: return `up_to_date` and change nothing. Older version: error `downgrade`,
   unless `allow_downgrade` is true.
4. Download the tarball. Refuse a URL that does not start with
   `https://github.com/zog-tech/herdling/releases/download/`. Compare its SHA-256 with the manifest.
5. Unpack it with the system `tar` into a temporary folder next to the executable.
6. Copy the new binary to `<exe>.new` in the same folder, `fsync`, set mode 0755, and rename it
   over the running executable. `<exe>` is `std::env::current_exe()` after `canonicalize`.
7. Restart the service: `launchctl kickstart -k gui/<uid>/com.zogtech.herdlingd` or
   `systemctl --user restart herdlingd.service`. Only when the unit file exists.
8. Reply.

The rpc process is not part of the service, so the restart does not stop it. The process still
runs the old code. After the reply the app reconnects, and the new SSH channel runs the new binary.
The app then reads the new version from `hello`.

A lock file (`~/.config/herdling/update.lock`) stops two updates at the same time
(error `update_in_progress`).

Error codes: `update_unavailable` (network or manifest failure), `unsupported_target`,
`checksum_mismatch`, `downgrade`, `update_in_progress`, `io_error`.

### CLI

`herdlingd update [--check] [--version X.Y.Z] [--allow-downgrade]` does the same and prints the
result. `herdlingd version` prints the version.

## D. App: install during setup

`setUpWithPassword` gets a new option `confirmInstall(host)`. When enroll answers `not_installed`:

1. The app shows "herdlingd is not on <host>. Install it now?". The text says: it downloads from
   GitHub, installs to `~/.local/bin`, adds a user service, and needs no admin rights.
   The buttons are "Install and pair" and "Cancel".
2. On "Install and pair", the app logs in again with the same password and the same pinned host key
   and runs the install command (below). It shows the steps.
3. On `HERDLINGD_INSTALLED`, it runs the enroll command again and saves the host.

Install command (run by the login shell, so it uses only `sh` and no single quotes inside):

```sh
sh -c 'U=https://herdling.zog-tech.com/install.sh;
if command -v curl >/dev/null 2>&1; then S=$(curl -fsSL "$U") || S=;
elif command -v wget >/dev/null 2>&1; then S=$(wget -qO- "$U") || S=;
else echo "HERDLINGD_ERROR no_downloader ..."; exit 1; fi;
[ -n "$S" ] || { echo "HERDLINGD_ERROR download_failed ..."; exit 1; };
printf "%s\n" "$S" | sh -s -- --quiet'
```

The native `execWithPassword` returns the output when the command ends. It does not stream.
So the app shows the current step ("Installing herdlingd…") and, at the end, the last output lines.
Live output lines need a native change; that is a later step. All of this part is JavaScript.

The timeout of the install login is 3 minutes. The password stays in memory for this one setup
call only. It is never saved, logged or shown.

The "Set up with password" row in Add host says that it installs `herdlingd` when necessary.

## E. App: update prompt

- A host with `update.check` in `hello.methods`: the app calls it at most once per host per day,
  and again after an update. It keeps the result on the saved host (`Host.updateCheck`).
- Settings, host row: "Update available: X → Y". Host screen: the same, with an
  "Update herdlingd" button. Overview: one quiet line for each out-of-date host. The user can
  close the line; it stays closed for that version (`Host.dismissedUpdate`).
- "Update herdlingd": a confirmation with the release notes, then `update.apply`
  (timeout 3 minutes), then a reconnect. The app shows the new version from `hello`.
- A host whose `herdlingd` does not have `update.apply`: "Update herdlingd: sign in once with
  your password". It runs the installer over the password login (part D) with the pinned host key.
- The demo host answers `update.check` with "up to date".

## Trust model

- The release binaries come from GitHub Actions in the public repository, from a tag. Anyone can
  read the workflow that built them.
- The installer and the update RPC download only over HTTPS and only from
  `github.com/zog-tech/herdling` release URLs. GitHub redirects the download to its storage host;
  the TLS certificate of each host is checked.
- The SHA-256 comes from the same release as the tarball. It protects against a broken or
  changed download, not against a person who controls the GitHub repository or the release.
  The binaries are not signed. A later step can add signatures (for example minisign or
  GitHub artifact attestations).
- The installer script comes from `herdling.zog-tech.com` over HTTPS (Cloudflare Pages).
  A person who controls the site can change the script.
- Nothing runs with `sudo`. The update replaces only the executable of the running `herdlingd`.
  The restricted phone key still runs only `herdlingd rpc`.
- The password is used only for the login. The app never logs it, saves it or puts it in a message.

## Compatibility

- New methods only. The app checks `hello.methods` before it calls `update.check` or `update.apply`.
- `hello.herdlingd` already holds the version (`CARGO_PKG_VERSION`).
- An older app ignores the new methods.
