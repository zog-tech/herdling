/**
 * Herdr 2 (herdr-core) on a computer: the text of `core.status`, the "Install Herdr 2" or
 * "Update Herdr 2" action (`core.install`) and the core note before a herdlingd update.
 *
 * The install is a pure state machine: idle → running → done or failed. Each run has a generation,
 * so a late result of an old run cannot change a newer state. Only idle, done and failed accept
 * "press", so one card cannot start two runs. herdlingd holds a file lock for other phones.
 */
import type { CoreInstall, CoreStatus, Hello, UpdateCore } from "@herdling/protocol";

import { listsMethod } from "./methods";

/** herdlingd downloads and installs the core; the protocol asks for a 3 minute limit. */
export const CORE_INSTALL_TIMEOUT_MS = 180_000;

/** True when the host can show its core: it lists `core.status`. */
export function hasCoreStatus(hello: Hello | undefined): boolean {
  return listsMethod(hello, "core.status");
}

/** True when the host can install the core: it lists `core.install`. */
export function hasCoreInstall(hello: Hello | undefined): boolean {
  return listsMethod(hello, "core.install");
}

/** The lines of the Herdr 2 card for a `core.status` result. */
export function coreStatusLines(s: CoreStatus): string[] {
  const lines: string[] = [];
  if (!s.found) lines.push("Not installed");
  else lines.push(`Installed: ${s.installed ?? "unknown version"}${s.managed ? " (package manager)" : ""}`);
  lines.push(s.running ? `Running${s.running_version ? `: ${s.running_version}` : ""}` : "Not running");
  lines.push(`herdlingd installs ${s.pinned}${s.newer_than_pin ? ". The core here is newer: herdlingd keeps it." : "."}`);
  if (s.herdr1) lines.push("herdr 1 is on this computer too.");
  if (s.found && !s.target) lines.push("Herdr 2 has no build for this computer.");
  return lines;
}

/** The label of the action button, or null when there is nothing to do or herdlingd must not do it. */
export function coreActionLabel(s: CoreStatus): string | null {
  if (s.managed || !s.update_available) return null;
  if (s.found === false && s.target === null) return null;
  return s.found ? "Update Herdr 2" : "Install Herdr 2";
}

/** The result text of `core.install`. */
export function coreInstallText(r: CoreInstall): string {
  const started = r.started ? " herdlingd started it." : "";
  switch (r.status) {
    case "installed":
      return `Herdr 2 ${r.to ?? r.pinned} is installed.${started}`;
    case "updated":
      return `Herdr 2 is updated${r.from ? ` from ${r.from}` : ""} to ${r.to ?? r.pinned}.${started}`;
    case "up_to_date":
      return `Herdr 2 ${r.to ?? r.pinned} is up to date.${started}`;
    case "kept_newer":
      return `The Herdr 2 here (${r.from ?? "newer"}) is newer than ${r.pinned}. herdlingd keeps it.${started}`;
    case "kept_managed":
      return `A package manager owns this Herdr 2. Update it there.${started}`;
    case "kept_unknown":
      return `The Herdr 2 here gives no version. herdlingd keeps it.${started}`;
  }
}

/** The text of a failed `core.install`. */
export function coreInstallErrorMessage(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : "";
  switch (code) {
    case "unsupported_target":
      return "Herdr 2 has no build for this computer.";
    case "download_failed":
      return "The download of Herdr 2 failed. Check the network of the computer, then try again.";
    case "checksum_mismatch":
      return "The download of Herdr 2 did not match its checksum. Nothing was installed.";
    case "core_not_running":
      return "Herdr 2 is installed, but it did not start.";
    case "busy":
      return "A Herdr 2 install already runs on this computer. Wait a moment, then try again.";
    case "timeout":
      return "The Herdr 2 install took too long. Check the status again in a moment.";
    case "disconnected":
      return "The connection closed during the install. Check the status when the computer is online again.";
    default:
      return `The Herdr 2 install failed${message ? `: ${message.slice(0, 400)}` : "."}`;
  }
}

/**
 * The note before a herdlingd update when the release needs Herdr 2: the core installs first, and
 * the `notice` of herdlingd (for example that herdr 1 sessions no longer show). Undefined when the
 * update does not touch the core.
 */
export function coreUpdateNote(core: UpdateCore | undefined): string | undefined {
  if (!core?.requires_core) return undefined;
  const first = core.install_first ? `Herdr 2 (herdr-core ${core.pinned}) installs first. If that fails, herdlingd stays as it is.` : "";
  return [first, core.notice?.trim() ?? ""].filter(Boolean).join(" ") || undefined;
}

export type CoreInstallState =
  | { phase: "idle"; gen: number }
  | { phase: "running"; gen: number }
  | { phase: "done"; gen: number; text: string }
  | { phase: "failed"; gen: number; text: string };

export type CoreInstallEvent = { type: "press" } | { type: "succeeded"; gen: number; text: string } | { type: "failed"; gen: number; text: string };

export type CoreInstallEffect = { type: "run"; gen: number };

export const initialCoreInstall: CoreInstallState = { phase: "idle", gen: 0 };

export function coreInstallReducer(s: CoreInstallState, e: CoreInstallEvent): { state: CoreInstallState; effects: CoreInstallEffect[] } {
  switch (e.type) {
    case "press": {
      if (s.phase === "running") return { state: s, effects: [] };
      const gen = s.gen + 1;
      return { state: { phase: "running", gen }, effects: [{ type: "run", gen }] };
    }
    case "succeeded":
      return s.phase === "running" && s.gen === e.gen ? { state: { phase: "done", gen: s.gen, text: e.text }, effects: [] } : { state: s, effects: [] };
    case "failed":
      return s.phase === "running" && s.gen === e.gen ? { state: { phase: "failed", gen: s.gen, text: e.text }, effects: [] } : { state: s, effects: [] };
  }
}

/**
 * The text when no runtime answers on the host. herdlingd 0.2.0 says what it does about the
 * Herdr 2 core (`hello.core_setup`: it installs it, or the install failed). Else the old text.
 */
export function runtimeDownText(name: string, hello: Pick<Hello, "core_setup">): string {
  return hello.core_setup?.message || `herdr is not running on ${name}. Start herdr in a terminal on that computer.`;
}
