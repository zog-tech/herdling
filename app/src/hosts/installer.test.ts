jest.mock("../../modules/ssh", () => ({}));

import type { PasswordExecOptions, PasswordExecResult } from "../../modules/ssh";
import { INSTALL_COMMAND, INSTALL_TIMEOUT_MS, installCommand, parseInstallOutput, runInstaller } from "./installer";

const FP = "SHA256:" + "a".repeat(43);
const PASSWORD = "correct horse battery staple";
const target = { host: "10.0.0.5", port: 22, user: "sam", password: PASSWORD, expectedFingerprint: FP };

function exec(result: Partial<PasswordExecResult> | { error: object }) {
  return jest.fn(async (o: PasswordExecOptions): Promise<PasswordExecResult> => {
    void o;
    if ("error" in result) throw result.error;
    return { stdout: "", stderr: "", exitCode: 0, hostFingerprint: FP, ...result };
  });
}

describe("INSTALL_COMMAND", () => {
  it("is the exact shell command (checked in zsh and bash against a local script)", () => {
    expect(INSTALL_COMMAND).toBe(
      String.raw`sh -c 'U=https://herdling.zog-tech.com/install.sh; if command -v curl >/dev/null 2>&1; then S=$(curl -fsSL "$U") || S=; elif command -v wget >/dev/null 2>&1; then S=$(wget -qO- "$U") || S=; else echo "HERDLINGD_ERROR no_downloader curl and wget are not installed"; exit 1; fi; [ -n "$S" ] || { echo "HERDLINGD_ERROR download_failed cannot download $U"; exit 1; }; printf "%s\n" "$S" | sh -s -- --quiet'`,
    );
    // The login shell gets one single-quoted word: no single quote may appear inside it.
    expect(INSTALL_COMMAND.slice(7, -1)).not.toContain("'");
  });
});

describe("installCommand", () => {
  it("adds --with-herdr only when asked", () => {
    expect(installCommand()).toBe(INSTALL_COMMAND);
    expect(installCommand(true)).toBe(INSTALL_COMMAND.replace("--quiet'", "--quiet --with-herdr'"));
    expect(installCommand(true).slice(7, -1)).not.toContain("'");
  });

  it("runs --with-herdr with a longer timeout", async () => {
    const run = exec({ stdout: "HERDLINGD_INSTALLED 0.2.0\n" });
    await runInstaller({ execWithPassword: run }, { ...target, withHerdr: true });
    expect(run.mock.calls[0][0].command).toBe(installCommand(true));
    expect(run.mock.calls[0][0].timeoutMs).toBeGreaterThan(INSTALL_TIMEOUT_MS);
  });
});

describe("HERDLINGD_BOOT", () => {
  it("reads the boot line, and is missing for an older script", () => {
    expect(parseInstallOutput("HERDLINGD_BOOT login\nHERDLINGD_INSTALLED 0.2.0\n", "", 0)).toEqual({ ok: true, version: "0.2.0", boot: "login" });
    expect(parseInstallOutput("HERDLINGD_BOOT boot\nHERDLINGD_INSTALLED 0.2.0\n", "", 0)).toMatchObject({ boot: "boot" });
    expect(parseInstallOutput("HERDLINGD_BOOT later\nHERDLINGD_INSTALLED 0.2.0\n", "", 0)).toMatchObject({ boot: "unknown" });
    const old = parseInstallOutput("HERDLINGD_INSTALLED 0.2.0\n", "", 0);
    expect(old).toEqual({ ok: true, version: "0.2.0" });
    expect("boot" in old).toBe(false);
  });

  it("maps herdr_install_failed", () => {
    const r = parseInstallOutput("HERDLINGD_STEP herdr\nHERDLINGD_ERROR herdr_install_failed The herdr installer failed: x\n", "", 1);
    expect(r).toMatchObject({ ok: false, code: "herdr_install_failed" });
    expect(!r.ok && r.message).toContain("https://herdr.dev");
  });
});

describe("parseInstallOutput", () => {
  it("reads the version from the last line", () => {
    const out = "HERDLINGD_STEP check\nHERDLINGD_STEP download\nHERDLINGD_STEP verify\nHERDLINGD_STEP install\nHERDLINGD_INSTALLED 0.2.0\n";
    expect(parseInstallOutput(out, "", 0)).toEqual({ ok: true, version: "0.2.0" });
  });

  it("maps script errors to codes and messages", () => {
    const herdr = parseInstallOutput("HERDLINGD_STEP check\nHERDLINGD_ERROR no_herdr herdr is not installed\n", "", 1);
    expect(herdr).toMatchObject({ ok: false, code: "no_herdr" });
    expect(!herdr.ok && herdr.message).toContain("https://herdr.dev");

    expect(parseInstallOutput("HERDLINGD_ERROR checksum_mismatch x\n", "", 1)).toMatchObject({ code: "checksum_mismatch" });
    expect(parseInstallOutput("HERDLINGD_ERROR no_downloader x\n", "", 1)).toMatchObject({ code: "no_downloader" });

    const win = parseInstallOutput("HERDLINGD_ERROR unsupported_os Windows (MINGW64_NT-10.0)\n", "", 1);
    expect(win).toMatchObject({ code: "unsupported_os", message: "Windows is not supported. herdlingd runs on macOS and Linux." });

    const failed = parseInstallOutput("HERDLINGD_ERROR install_failed systemctl failed\n", "", 1);
    expect(failed).toMatchObject({ code: "install_failed", message: "The install did not finish: systemctl failed" });

    expect(parseInstallOutput("HERDLINGD_ERROR something_new text\n", "", 1)).toMatchObject({ code: "install_failed" });
  });

  it("sees a Windows shell with no sh", () => {
    const cmd = parseInstallOutput("", "'sh' is not recognized as an internal or external command,\noperable program or batch file.\n", 1);
    expect(cmd).toMatchObject({ ok: false, code: "unsupported_os" });
    const ps = parseInstallOutput("", "sh : The term 'sh' is not recognized as the name of a cmdlet, function", 1);
    expect(ps).toMatchObject({ code: "unsupported_os" });
  });

  it("no result line is a failure with the last lines", () => {
    const r = parseInstallOutput("HERDLINGD_STEP download\n", "sh: 3: oops\n", 2);
    expect(r).toMatchObject({ ok: false, code: "install_failed" });
    expect(!r.ok && r.lines).toEqual(["HERDLINGD_STEP download", "sh: 3: oops"]);
    expect(!r.ok && r.message).toContain("oops");
    // An installed line with a non-zero exit is not a success.
    expect(parseInstallOutput("HERDLINGD_INSTALLED 0.2.0\n", "", 1)).toMatchObject({ ok: false });
  });
});

describe("runInstaller", () => {
  it("runs the command with the pinned key and a long timeout", async () => {
    const e = exec({ stdout: "HERDLINGD_INSTALLED 0.2.0\n" });
    expect(await runInstaller({ execWithPassword: e }, target)).toEqual({ ok: true, version: "0.2.0" });
    expect(e.mock.calls[0][0]).toEqual({
      host: "10.0.0.5",
      port: 22,
      user: "sam",
      password: PASSWORD,
      command: INSTALL_COMMAND,
      stdin: "",
      expectedFingerprint: FP,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
  });

  it("maps native errors and never returns the password", async () => {
    for (const code of ["auth_failed", "host_key_mismatch", "timeout"]) {
      const r = await runInstaller({ execWithPassword: exec({ error: { code, message: PASSWORD } }) }, target);
      expect(r).toMatchObject({ ok: false, code });
      expect(JSON.stringify(r)).not.toContain(PASSWORD);
    }
    const r = await runInstaller({ execWithPassword: exec({ error: { code: "connect_failed" } }) }, target);
    expect(r).toMatchObject({ code: "unreachable" });

    const echoed = await runInstaller(
      { execWithPassword: exec({ stdout: `HERDLINGD_ERROR install_failed bad ${PASSWORD}\n`, exitCode: 1 }) },
      target,
    );
    expect(JSON.stringify(echoed)).not.toContain(PASSWORD);
  });

  it("refuses a different host key", async () => {
    const e = exec({ stdout: "HERDLINGD_INSTALLED 0.2.0\n", hostFingerprint: "SHA256:" + "b".repeat(43) });
    expect(await runInstaller({ execWithPassword: e }, target)).toMatchObject({ ok: false, code: "host_key_mismatch" });
  });
});
