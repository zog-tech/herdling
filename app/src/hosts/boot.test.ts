import type { Boot, Hello } from "@herdling/protocol";

import { bootCase, bootOf, bootResultText, bootSteps, canOpenMacSettings, checkBoot, openMacSettings, paneFor, startsAtLogin } from "./boot";
import type { RpcClient } from "../rpc/RpcClient";

const hello = (over: Partial<Hello> = {}): Hello => ({ host: "studio", os: "macos", herdlingd: "0.1.1", herdr_ok: true, ...over });
const login: Boot = { starts_at: "login", how: "Turn on automatic login.", reason: "auto_login_off", user: "sam" };

test("an older herdlingd has no boot state and no hint", () => {
  expect(bootOf(hello())).toBeUndefined();
  expect(startsAtLogin(hello())).toBe(false);
  expect(startsAtLogin(undefined)).toBe(false);
});

test("the hint shows only for login", () => {
  expect(startsAtLogin(hello({ boot: login }))).toBe(true);
  expect(startsAtLogin(hello({ boot: { ...login, starts_at: "boot" } }))).toBe(false);
  expect(startsAtLogin(hello({ boot: { ...login, starts_at: "unknown" } }))).toBe(false);
});

test("the case follows the OS and FileVault", () => {
  expect(bootCase("macos", login)).toBe("mac_auto_login");
  expect(bootCase("macos", { ...login, reason: "filevault_on" })).toBe("mac_filevault");
  expect(bootCase("linux", { ...login, reason: "linger_off" })).toBe("linux_linger");
  expect(paneFor("mac_auto_login")).toBe("users_groups");
  expect(paneFor("mac_filevault")).toBe("filevault");
  expect(paneFor("linux_linger")).toBeUndefined();
});

test("the steps use the user name", () => {
  const mac = bootSteps("mac_auto_login", "sam").map((s) => s.text).join("\n");
  expect(mac).toContain("Users & Groups");
  expect(mac).toContain('Automatically log in as" and choose "sam"');
  const linux = bootSteps("linux_linger", "sam");
  expect(linux.map((s) => s.command)).toContain("sudo loginctl enable-linger sam");
  expect(bootSteps("linux_linger").map((s) => s.command)).toContain("sudo loginctl enable-linger $USER");
  expect(bootSteps("mac_filevault", "sam").map((s) => s.text).join("\n")).toContain("log in on the Mac once");
});

test("open settings needs a Mac that lists the method", () => {
  expect(canOpenMacSettings(hello({ methods: ["mac.open_settings"] }))).toBe(true);
  expect(canOpenMacSettings(hello())).toBe(false);
  expect(canOpenMacSettings(hello({ os: "linux", methods: ["mac.open_settings"] }))).toBe(false);
});

test("the rpc calls send only the pane id", async () => {
  const call = jest.fn(async (method: string, params?: object) => {
    void params;
    return method === "boot.check" ? login : { opened: "sharing" };
  });
  const rpc = { call } as unknown as RpcClient;
  expect(await checkBoot(rpc)).toEqual(login);
  await openMacSettings(rpc, "sharing");
  expect(call.mock.calls.map((c) => [c[0], c[1]])).toEqual([
    ["boot.check", {}],
    ["mac.open_settings", { pane: "sharing" }],
  ]);
});

test("result text after a check", () => {
  expect(bootResultText({ ...login, starts_at: "boot" })).toMatchObject({ ok: true });
  expect(bootResultText(login)).toEqual({ ok: false, text: "herdlingd still starts only after a login. Turn on automatic login." });
});
