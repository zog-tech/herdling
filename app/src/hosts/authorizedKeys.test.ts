import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authorizedKeysCommand } from "./authorizedKeys";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleExampleExampleExampleExample zogssh";

describe("authorizedKeysCommand", () => {
  it("writes a restricted line with the expanded absolute path and the intact key", () => {
    const home = mkdtempSync(join(tmpdir(), "zogssh-"));
    mkdirSync(join(home, ".ssh"));
    execFileSync("sh", ["-c", authorizedKeysCommand(KEY)], { env: { ...process.env, HOME: home } });
    const line = readFileSync(join(home, ".ssh", "authorized_keys"), "utf8");
    expect(line).toBe(`restrict,command="${home}/.local/bin/zogsshd rpc" ${KEY}\n`);
  });
});
