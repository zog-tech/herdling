/**
 * The recent shell commands of each host: the lines the user sent from the phone to a shell
 * (the terminal box, the Shell command of New session, the run sheet). The terminal shows them as
 * chips, so the user does not type a command again. Commands typed into an agent pane stay out.
 * `addRecent` and `removeRecent` are the pure rules; the store persists them like other settings.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

/** The most commands kept for one host. */
export const RECENT_COMMAND_CAP = 20;
/** A longer command is not kept: a cut command must not run by mistake. */
export const RECENT_COMMAND_MAX_CHARS = 500;

/** The command as it is kept: without trailing spaces and line ends. Null when it is not kept. */
export function normalizeCommand(cmd: string): string | null {
  const c = cmd.replace(/\s+$/, "");
  if (!c.trim() || c.length > RECENT_COMMAND_MAX_CHARS) return null;
  return c;
}

/** The list with `cmd` at the front: newest first, each command once, at most `cap` commands. */
export function addRecent(list: readonly string[], cmd: string, cap = RECENT_COMMAND_CAP): readonly string[] {
  const c = normalizeCommand(cmd);
  if (c === null) return list;
  if (list[0] === c) return list;
  return [c, ...list.filter((x) => x !== c)].slice(0, cap);
}

/** The list without `cmd`. */
export function removeRecent(list: readonly string[], cmd: string): readonly string[] {
  return list.includes(cmd) ? list.filter((x) => x !== cmd) : list;
}

type Store = { byHost: Record<string, readonly string[]> };

export const useRecentCommands = create<Store>()(
  persist(() => ({ byHost: {} }) as Store, { name: "herdling.recent_commands", storage: secureJSONStorage() }),
);

/** One empty list for every host without commands, so a selector keeps the same value. */
export const NO_COMMANDS: readonly string[] = [];

/** The recent commands of `hostId`, newest first. */
export function useHostCommands(hostId: string): readonly string[] {
  return useRecentCommands((s) => s.byHost[hostId] ?? NO_COMMANDS);
}

function update(hostId: string, f: (list: readonly string[]) => readonly string[]): void {
  useRecentCommands.setState((s) => {
    const had = s.byHost[hostId] ?? NO_COMMANDS;
    const next = f(had);
    return next === had ? s : { byHost: { ...s.byHost, [hostId]: next } };
  });
}

/** Keeps a command that the user sent to a shell on `hostId`. Empty and too long commands are skipped. */
export function rememberCommand(hostId: string, cmd: string): void {
  update(hostId, (l) => addRecent(l, cmd));
}

export function forgetCommand(hostId: string, cmd: string): void {
  update(hostId, (l) => removeRecent(l, cmd));
}
