/**
 * herdr agent integrations of one computer. An integration is a hook or a plugin that herdr puts
 * in the configuration of an agent (for example the Claude Code hooks). With it, the agent tells
 * herdr its status, so herdr does not have to guess it from the screen.
 *
 * herdr 0.9 socket API (`herdr api schema --json`, protocol 22):
 * - `integration.list`, params `{}` →
 *   `{ type: "integration_list", integrations: [{ target, label, command, available, state }] }`,
 *   `state` is `"not_installed" | "current" | "outdated"`.
 * - `integration.install`, params `{ target }` →
 *   `{ type: "integration_install", target, details: { messages: string[] } }`.
 * An older herdr does not know these methods: `callHerdr` remembers that per host.
 */
import type { RpcClient } from "@/rpc/RpcClient";

import { callHerdr } from "./support";

type Rpc = Pick<RpcClient, "call">;

export type IntegrationState = "not_installed" | "current" | "outdated";

/** One item of `integration.list`. */
export type IntegrationInfo = {
  /** The herdr name of the integration, for example `claude` or `antigravity_cli`. */
  target: string;
  /** The agent name to show, for example "Claude Code". */
  label: string;
  /** The command of the agent. */
  command: string;
  /** True when herdr finds the agent on the computer. */
  available: boolean;
  state: IntegrationState;
};

export const LIST_METHOD = "integration.list";
export const INSTALL_METHOD = "integration.install";

/** An install edits files on the computer; give herdr more time than a read. */
export const INSTALL_TIMEOUT_MS = 30_000;

const STATES: readonly string[] = ["not_installed", "current", "outdated"];

/** The integrations from an `integration.list` result. Items with a missing field are left out. */
export function parseIntegrations(result: unknown): IntegrationInfo[] {
  const list = (result as { integrations?: unknown } | null)?.integrations;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): IntegrationInfo[] => {
    const i = raw as Partial<Record<keyof IntegrationInfo, unknown>>;
    if (typeof i.target !== "string" || !i.target) return [];
    const state = typeof i.state === "string" && STATES.includes(i.state) ? (i.state as IntegrationState) : "not_installed";
    return [
      {
        target: i.target,
        label: typeof i.label === "string" && i.label ? i.label : i.target,
        command: typeof i.command === "string" ? i.command : i.target,
        available: i.available !== false,
        state,
      },
    ];
  });
}

export async function listIntegrations(rpc: Rpc, hostId: string): Promise<IntegrationInfo[]> {
  return parseIntegrations(await callHerdr(rpc, hostId, LIST_METHOD, {}));
}

/** Installs (or updates) one integration. Returns the lines that herdr reports. */
export async function installIntegration(rpc: Rpc, hostId: string, target: string): Promise<string[]> {
  const r = await callHerdr<{ details?: { messages?: unknown } }>(rpc, hostId, INSTALL_METHOD, { target }, INSTALL_TIMEOUT_MS);
  const msgs = r?.details?.messages;
  return Array.isArray(msgs) ? msgs.filter((m): m is string => typeof m === "string") : [];
}

/** The three parts of the screen. */
export type IntegrationGroups = {
  /** On the computer, without a current integration: they need an install or an update. */
  missing: IntegrationInfo[];
  /** Installed and current. */
  installed: IntegrationInfo[];
  /** herdr does not find the agent on the computer and has no integration for it. */
  absent: IntegrationInfo[];
};

const byLabel = (a: IntegrationInfo, b: IntegrationInfo) => a.label.localeCompare(b.label);

/** Splits the list for the screen. Outdated comes before not installed; each part is sorted by label. */
export function groupIntegrations(list: IntegrationInfo[]): IntegrationGroups {
  const missing = list
    .filter((i) => i.state !== "current" && (i.available || i.state === "outdated"))
    .sort((a, b) => Number(b.state === "outdated") - Number(a.state === "outdated") || byLabel(a, b));
  return {
    missing,
    installed: list.filter((i) => i.state === "current").sort(byLabel),
    absent: list.filter((i) => i.state === "not_installed" && !i.available).sort(byLabel),
  };
}

/** The state as a short word. */
export function stateLabel(i: IntegrationInfo): string {
  switch (i.state) {
    case "current":
      return "Installed";
    case "outdated":
      return "Old version";
    default:
      return i.available ? "Not installed" : "Agent not found";
  }
}

/** The label of the button of one integration, or undefined when it needs none. */
export function actionLabel(i: IntegrationInfo): string | undefined {
  if (i.state === "outdated") return "Update";
  if (i.state === "not_installed") return "Install";
  return undefined;
}

/** The title and text of the confirm before an install: what changes on the computer. */
export function installConfirm(i: IntegrationInfo, hostName: string): { title: string; message: string; action: string } {
  const update = i.state === "outdated";
  return {
    title: update ? `Update the ${i.label} integration?` : `Install the ${i.label} integration?`,
    message: update
      ? `herdr replaces its old hook in the ${i.label} configuration on ${hostName} with the new version.`
      : `herdr adds a hook to the ${i.label} configuration in your home folder on ${hostName}. ` +
        `${i.label} then tells herdr when it works, waits for you or is done. ` +
        `To remove it, run "herdr integration uninstall ${i.target}" on the computer.`,
    action: update ? "Update" : "Install",
  };
}

/** The integration of the agent kind when it is not current, else undefined. The hint in "Why this status?" uses it. */
export function needsIntegration(list: IntegrationInfo[], kind: string | null | undefined): IntegrationInfo | undefined {
  if (!kind) return undefined;
  return list.find((i) => (i.target === kind || i.command === kind) && i.state !== "current");
}
