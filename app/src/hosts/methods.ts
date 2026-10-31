import type { Hello } from "@herdling/protocol";

/** Every herdlingd method this app calls. Keep it in step with the calls in `src/`. */
export const APP_METHODS = [
  "hello",
  "ping",
  "herdr.call",
  "herdr.subscribe",
  "rpc.cancel",
  "thread.get",
  "thread.subagent",
  "thread.resolve",
  "thread.follow",
  "sessions.recent",
  "fs.dirs",
  "push.register",
  "pair.revoke",
  "stats.get",
  "usage.get",
  "automations.list",
  "automations.runs",
  "automations.approve",
  "summary.make",
  "tts.make",
  "agents.preview",
  "commands.list",
  "files.put",
  "stt.make",
  "update.check",
  "update.apply",
  "boot.check",
  "mac.open_settings",
  "git.status",
  "git.diff",
  "git.worktree_add",
  "pane.watch",
  "agents.installed",
  "ports.list",
  "preview.open",
  "preview.close",
] as const;

/** True when the host has the method. True too when the host does not say (an older herdlingd): the caller tries and falls back. */
export function hasMethod(hello: Hello | undefined, method: string): boolean {
  const methods = hello?.methods;
  return methods === undefined || methods.includes(method);
}

/** True only when the host lists its methods and the list holds `method`. An older herdlingd that does not list them gives false. */
export function listsMethod(hello: Hello | undefined, method: string): boolean {
  return hello?.methods?.includes(method) ?? false;
}

/** True when the host is online and misses a method the app uses, or does not list its methods at all. */
export function needsHerdlingdUpdate(hello: Hello | undefined): boolean {
  if (!hello) return false;
  const methods = hello.methods;
  return methods === undefined || APP_METHODS.some((m) => !methods.includes(m));
}

export const UPDATE_HERDLINGD_HINT = "Update herdlingd on this host for all features";
