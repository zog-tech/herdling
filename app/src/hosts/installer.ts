import type { PasswordExecOptions, PasswordExecResult } from "../../modules/ssh";

/**
 * Runs the herdlingd installer script over a one-shot password login and reads its result.
 *
 * The script (`site/public/install.sh`) prints machine-readable lines with `--quiet`:
 * `HERDLINGD_STEP <step>`, then `HERDLINGD_INSTALLED <version>` or `HERDLINGD_ERROR <code> <text>`.
 * A newer script also prints `HERDLINGD_BOOT boot|login|unknown` before `HERDLINGD_INSTALLED`.
 * An older script does not: the boot state is then not known.
 * The native exec returns the output when the command ends; it does not stream.
 */

export const INSTALL_URL = "https://herdling.zog-tech.com/install.sh";

/**
 * Downloads the script into a variable first (with curl, else wget), so a failed download does not
 * run an empty or half script. The login shell runs it, so the body has no single quotes.
 * `withHerdr` adds `--with-herdr`: the script first runs the official herdr installer when herdr is missing.
 */
export function installCommand(withHerdr = false): string {
  return (
    `sh -c 'U=${INSTALL_URL}; ` +
    `if command -v curl >/dev/null 2>&1; then S=$(curl -fsSL "$U") || S=; ` +
    `elif command -v wget >/dev/null 2>&1; then S=$(wget -qO- "$U") || S=; ` +
    `else echo "HERDLINGD_ERROR no_downloader curl and wget are not installed"; exit 1; fi; ` +
    `[ -n "$S" ] || { echo "HERDLINGD_ERROR download_failed cannot download $U"; exit 1; }; ` +
    `printf "%s\\n" "$S" | sh -s -- --quiet${withHerdr ? " --with-herdr" : ""}'`
  );
}

export const INSTALL_COMMAND = installCommand();

/** Bound for the whole install login: download, check and service start. */
export const INSTALL_TIMEOUT_MS = 180_000;

export const HERDR_URL = "https://herdr.dev";

export type InstallFailCode =
  | "unsupported_os"
  | "unsupported_arch"
  | "no_herdr"
  | "herdr_install_failed"
  | "no_downloader"
  | "no_checksum_tool"
  | "download_failed"
  | "checksum_mismatch"
  | "install_failed"
  | "auth_failed"
  | "host_key_mismatch"
  | "timeout"
  | "unreachable";

/** When the installed service starts, from `HERDLINGD_BOOT`. */
export type InstallBoot = "boot" | "login" | "unknown";

export type InstallResult =
  /** `boot`: missing when the script is older and does not say. */
  | { ok: true; version: string; boot?: InstallBoot }
  /** `lines`: the last output lines, for the user to read. */
  | { ok: false; code: InstallFailCode; message: string; lines: string[] };

const SCRIPT_CODES: readonly InstallFailCode[] = [
  "unsupported_os",
  "unsupported_arch",
  "no_herdr",
  "herdr_install_failed",
  "no_downloader",
  "no_checksum_tool",
  "download_failed",
  "checksum_mismatch",
  "install_failed",
];

/** The text for the user. `detail` is the script's own text, used where it helps. */
export function installMessage(code: InstallFailCode, detail?: string): string {
  switch (code) {
    case "unsupported_os":
      return detail && !/windows/i.test(detail)
        ? `This computer is not supported: ${detail}. herdlingd runs on macOS and Linux.`
        : "Windows is not supported. herdlingd runs on macOS and Linux.";
    case "unsupported_arch":
      return `herdlingd has no build for this processor${detail ? ` (${detail})` : ""}. Build it from source.`;
    case "no_herdr":
      return `herdr is not installed on this computer. Install herdr first (${HERDR_URL}), then try again.`;
    case "herdr_install_failed":
      return `herdr could not be installed${detail ? `: ${detail.slice(0, 200)}` : "."} Install herdr from ${HERDR_URL}, then try again.`;
    case "no_downloader":
      return "The computer has no curl or wget. Install one of them, then try again.";
    case "no_checksum_tool":
      return "The computer has no shasum or sha256sum, so the download cannot be checked. Nothing was installed.";
    case "download_failed":
      return "The download failed. Check that the computer can reach github.com, then try again.";
    case "checksum_mismatch":
      return "The downloaded file is damaged or changed (checksum mismatch). Nothing was installed.";
    case "install_failed":
      return `The install did not finish${detail ? `: ${detail.slice(0, 200)}` : "."}`;
    case "auth_failed":
      return "The host did not accept the user name and password, or it does not allow password login.";
    case "host_key_mismatch":
      return "The host key is not the pinned key. Nothing was sent.";
    case "timeout":
      return "The install took too long. Check the network of the computer, then try again.";
    case "unreachable":
      return "Can't reach the host. Check the host and port.";
  }
}

/** Text from cmd.exe or PowerShell when `sh` does not exist. */
const WINDOWS_SHELL = /is not recognized as (an internal or external command|the name of a cmdlet)|The term 'sh' is not recognized/i;

/** Reads the installer output. The last result line wins. */
export function parseInstallOutput(stdout: string, stderr: string, exitCode: number): InstallResult {
  const out = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const lines = [...out, ...stderr.split("\n").map((l) => l.trim()).filter(Boolean)].slice(-8);
  for (let i = out.length - 1; i >= 0; i--) {
    const m = /^HERDLINGD_(INSTALLED|ERROR)\s+(\S+)\s*(.*)$/.exec(out[i]);
    if (!m) continue;
    if (m[1] === "INSTALLED") {
      if (exitCode !== 0) break;
      const boot = parseBootLine(out);
      return boot ? { ok: true, version: m[2], boot } : { ok: true, version: m[2] };
    }
    const code = (SCRIPT_CODES as readonly string[]).includes(m[2]) ? (m[2] as InstallFailCode) : "install_failed";
    const detail = m[3] || undefined;
    return { ok: false, code, message: installMessage(code, detail), lines };
  }
  if (!out.some((l) => l.startsWith("HERDLINGD_")) && WINDOWS_SHELL.test(`${stdout}\n${stderr}`)) {
    return { ok: false, code: "unsupported_os", message: installMessage("unsupported_os"), lines };
  }
  const last = [...lines].reverse().find((l) => !l.startsWith("HERDLINGD_STEP"));
  return { ok: false, code: "install_failed", message: installMessage("install_failed", last), lines };
}

/** The last `HERDLINGD_BOOT` line, if any. A value that is not known counts as "unknown". */
function parseBootLine(out: string[]): InstallBoot | undefined {
  for (let i = out.length - 1; i >= 0; i--) {
    const m = /^HERDLINGD_BOOT\s+(\S+)/.exec(out[i]);
    if (m) return m[1] === "boot" || m[1] === "login" ? m[1] : "unknown";
  }
  return undefined;
}

export type InstallerDeps = {
  execWithPassword: (o: PasswordExecOptions) => Promise<PasswordExecResult>;
};

export type InstallTarget = {
  host: string;
  port: number;
  user: string;
  password: string;
  /** The confirmed or pinned host key. A different key stops the login before the password is sent. */
  expectedFingerprint: string;
  /** Adds `--with-herdr`. Only after the user chose to install herdr. */
  withHerdr?: boolean;
};

/**
 * Logs in once with the password and runs the installer. Never throws: native errors become a
 * failed result. The password is never part of the result.
 */
export async function runInstaller(deps: InstallerDeps, t: InstallTarget): Promise<InstallResult> {
  let res: PasswordExecResult;
  try {
    res = await deps.execWithPassword({
      host: t.host,
      port: t.port,
      user: t.user,
      password: t.password,
      command: installCommand(t.withHerdr),
      stdin: "",
      expectedFingerprint: t.expectedFingerprint,
      // herdr is one more download of about 20 MB.
      timeoutMs: t.withHerdr ? INSTALL_TIMEOUT_MS + 120_000 : INSTALL_TIMEOUT_MS,
    });
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    const mapped: InstallFailCode =
      code === "auth_failed" || code === "host_key_mismatch" || code === "timeout"
        ? code
        : code === "exec_failed"
          ? "install_failed"
          : "unreachable";
    return { ok: false, code: mapped, message: installMessage(mapped), lines: [] };
  }
  if (res.hostFingerprint !== t.expectedFingerprint) {
    return { ok: false, code: "host_key_mismatch", message: installMessage("host_key_mismatch"), lines: [] };
  }
  const result = parseInstallOutput(res.stdout, res.stderr, res.exitCode);
  if (result.ok || !t.password) return result;
  const hide = (s: string) => s.split(t.password).join("***");
  return { ...result, message: hide(result.message), lines: result.lines.map(hide) };
}
