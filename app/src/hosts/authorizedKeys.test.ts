import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authorizedKeysCommand } from "./authorizedKeys";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleExampleExampleExampleExample zogssh";

/** Runs the command in sh with a temp HOME and returns the home path and the written line. */
function run(command?: string): { home: string; line: string } {
  const home = mkdtempSync(join(tmpdir(), "zogssh-"));
  mkdirSync(join(home, ".ssh"));
  execFileSync("sh", ["-c", authorizedKeysCommand(KEY, command)], { env: { ...process.env, HOME: home } });
  return { home, line: readFileSync(join(home, ".ssh", "authorized_keys"), "utf8") };
}

describe("authorizedKeysCommand", () => {
  it("writes a restricted line with the expanded absolute path and the intact key", () => {
    const { home, line } = run();
    expect(line).toBe(`restrict,command="${home}/.local/bin/zogsshd rpc" ${KEY}\n`);
  });

  it("keeps the $HOME prefix for a command that starts with zogsshd", () => {
    const { home, line } = run("zogsshd rpc --verbose");
    expect(line).toBe(`restrict,command="${home}/.local/bin/zogsshd rpc --verbose" ${KEY}\n`);
  });

  it("uses an absolute path as is", () => {
    const { line } = run("/opt/zogssh/bin/zogsshd rpc");
    expect(line).toBe(`restrict,command="/opt/zogssh/bin/zogsshd rpc" ${KEY}\n`);
  });
});
