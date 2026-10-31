import type { Boot, Hello, MacOpenSettings, MacSettingsPane } from "@herdling/protocol";

import type { RpcClient } from "../rpc/RpcClient";
import { listsMethod } from "./methods";
import { MAC_OPEN_SETTINGS, type Step } from "./steps";

/** The quiet hint when herdlingd starts only after a login. */
export const LOGIN_HINT = "Starts after you log in on this computer";

/** The boot state of an online host, when it has one. An older herdlingd does not report it. */
export function bootOf(hello: Hello | undefined): Boot | undefined {
  const b = hello?.boot;
  if (!b || typeof b !== "object" || typeof b.starts_at !== "string") return undefined;
  return b;
}

/** True when the host should show the "Starts after you log in" hint. */
export function startsAtLogin(hello: Hello | undefined): boolean {
  return bootOf(hello)?.starts_at === "login";
}

/** What the boot walkthrough explains for this host. */
export type BootCase = "mac_auto_login" | "mac_filevault" | "linux_linger";

export function bootCase(os: Hello["os"], boot: Boot | undefined): BootCase {
  if (os === "linux") return "linux_linger";
  return boot?.reason === "filevault_on" ? "mac_filevault" : "mac_auto_login";
}

/** The steps of a boot walkthrough. `user` is the user name on the computer, when known. */
export function bootSteps(c: BootCase, user?: string): Step[] {
  const who = user ? `"${user}"` : "your user";
  const u = user ?? "$USER";
  switch (c) {
    case "mac_auto_login":
      return [
        { text: MAC_OPEN_SETTINGS },
        { text: "In the sidebar, click Users & Groups." },
        { text: `Find "Automatically log in as" and choose ${who}.` },
        { text: `Enter the password of ${who} and click OK.` },
        {
          text: 'If "Automatically log in as" is grey or missing, FileVault is on. Then automatic login is not possible: see below.',
        },
      ];
    case "mac_filevault":
      return [
        {
          text: "FileVault is on. It encrypts the disk and asks for a password when the Mac starts, so macOS cannot log in automatically.",
        },
        {
          text: `After each restart, log in on the Mac once as ${who}. herdlingd starts then, and stays on while you are logged in.`,
        },
        { text: "You can lock the screen after you log in. herdlingd keeps running." },
      ];
    case "linux_linger":
      return [
        { text: "Open a terminal on the computer, or log in to it with SSH." },
        { text: "Turn on lingering for your user. It asks for your password once:", command: `sudo loginctl enable-linger ${u}` },
        { text: "Check it. The answer must be Linger=yes:", command: `loginctl show-user ${u} -p Linger` },
      ];
  }
}

/** The extra text about turning off FileVault, for the FileVault case. */
export const FILEVAULT_OFF_NOTE =
  "You can also turn off FileVault (System Settings > Privacy & Security > FileVault), then turn on automatic login. Your data is then less protected if someone takes the Mac.";

/**
 * herdr has no login service of its own. Only what herdr documents is named here: `herdr` starts
 * or attaches to its background server, and the server keeps running when the terminal closes.
 */
export const HERDR_BOOT_NOTE =
  "herdr must run too, and it does not start by itself after a restart. After each restart, open a terminal on the computer and run herdr. Then you can close the window: herdr keeps running in the background.";

/** The System Settings page that helps for this case. */
export function paneFor(c: BootCase): MacSettingsPane | undefined {
  return c === "mac_auto_login" ? "users_groups" : c === "mac_filevault" ? "filevault" : undefined;
}

/** True when the host can open System Settings on its screen. */
export function canOpenMacSettings(hello: Hello | undefined): boolean {
  return hello?.os === "macos" && listsMethod(hello, "mac.open_settings");
}

/** Reads the boot state again. Throws an `RpcError` on failure. */
export async function checkBoot(rpc: RpcClient): Promise<Boot> {
  return rpc.call<Boot>("boot.check", {}, 15_000);
}

/** Opens an allow-listed System Settings page on the Mac screen. */
export async function openMacSettings(rpc: RpcClient, pane: MacSettingsPane): Promise<MacOpenSettings> {
  return rpc.call<MacOpenSettings>("mac.open_settings", { pane }, 15_000);
}

/** The result line after "Done, check again". */
export function bootResultText(b: Boot): { ok: boolean; text: string } {
  if (b.starts_at === "boot") return { ok: true, text: "Done. herdlingd now starts when the computer starts." };
  if (b.starts_at === "unknown") return { ok: false, text: `Herdling cannot tell. ${b.how}` };
  return { ok: false, text: `herdlingd still starts only after a login. ${b.how}` };
}
