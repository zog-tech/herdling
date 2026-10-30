import { Alert } from "react-native";
import { create } from "zustand";

import { RpcError, type RpcClient } from "@/rpc/RpcClient";
import * as haptics from "@/ui/haptics";

import { renameAgent } from "./sessionActions";
import type { AgentInfo, Snapshot } from "./snapshot";
import { useSnapshots } from "./snapshotStore";

type Rpc = Pick<RpcClient, "call">;

/**
 * Rename from the phone, like the herdr apps: the session (agent name), its tab or its workspace.
 * The snapshot store changes at once and goes back when herdr refuses.
 */
export type RenameKind = "session" | "tab" | "workspace";

export const RENAME_METHOD: Record<RenameKind, string> = {
  session: "agent.rename",
  tab: "tab.rename",
  workspace: "workspace.rename",
};

export const RENAME_LABEL: Record<RenameKind, string> = {
  session: "Rename session",
  tab: "Rename tab",
  workspace: "Rename workspace",
};

/** herdr methods a host refused as unknown, per host id. Their rename items are hidden. */
export const useRenameSupport = create<{ missing: Record<string, string[]> }>(() => ({ missing: {} }));

export function renameSupported(hostId: string, kind: RenameKind): boolean {
  return !(useRenameSupport.getState().missing[hostId] ?? []).includes(RENAME_METHOD[kind]);
}

/** An older herdr answers an unknown method with `unknown_method` or "unknown method". */
export function isUnknownMethod(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  const msg = e instanceof Error ? e.message : String(e);
  return code === "unknown_method" || /unknown method/i.test(msg);
}

function markMissing(hostId: string, method: string): void {
  useRenameSupport.setState((s) => {
    const cur = s.missing[hostId] ?? [];
    return cur.includes(method) ? s : { missing: { ...s.missing, [hostId]: [...cur, method] } };
  });
}

export type RenameTarget = Pick<AgentInfo, "pane_id" | "tab_id" | "workspace_id">;

/** The name the prompt starts with. */
export function currentName(snapshot: Snapshot, kind: RenameKind, t: RenameTarget): string {
  switch (kind) {
    case "session":
      return snapshot.agents.find((a) => a.pane_id === t.pane_id)?.name ?? "";
    case "tab":
      return snapshot.tabs.find((x) => x.tab_id === t.tab_id)?.label ?? "";
    case "workspace":
      return snapshot.workspaces.find((x) => x.workspace_id === t.workspace_id)?.label ?? "";
  }
}

/** The snapshot with the new name in place. */
export function withName(snapshot: Snapshot, kind: RenameKind, t: RenameTarget, value: string | null): Snapshot {
  switch (kind) {
    case "session":
      return { ...snapshot, agents: snapshot.agents.map((a) => (a.pane_id === t.pane_id ? { ...a, name: value } : a)) };
    case "tab":
      return { ...snapshot, tabs: snapshot.tabs.map((x) => (x.tab_id === t.tab_id ? { ...x, label: value ?? x.label } : x)) };
    case "workspace":
      return {
        ...snapshot,
        workspaces: snapshot.workspaces.map((x) => (x.workspace_id === t.workspace_id ? { ...x, label: value ?? x.label } : x)),
      };
  }
}

function patchStore(hostId: string, fn: (s: Snapshot) => Snapshot): void {
  useSnapshots.setState((st) => {
    const cur = st.byHost[hostId];
    return cur ? { byHost: { ...st.byHost, [hostId]: fn(cur) } } : st;
  });
}

/**
 * Sends one rename. Empty text: a session loses its name (herdr clears it with `name: null`);
 * a tab or workspace keeps its label, because herdr needs one. Returns false when nothing was sent.
 */
export async function rename(rpc: Rpc, hostId: string, kind: RenameKind, t: RenameTarget, text: string): Promise<boolean> {
  const value = text.trim();
  if (!value && kind !== "session") return false;
  const snap = useSnapshots.getState().byHost[hostId];
  const before = snap ? currentName(snap, kind, t) : undefined;
  if (snap && value === (before ?? "")) return false;
  patchStore(hostId, (s) => withName(s, kind, t, value || null));
  try {
    if (kind === "session") {
      if (value) await renameAgent(rpc, t.pane_id, value);
      else await rpc.call("herdr.call", { method: "agent.rename", params: { target: t.pane_id, name: null } });
    } else if (kind === "tab") {
      await rpc.call("herdr.call", { method: "tab.rename", params: { tab_id: t.tab_id, label: value } });
    } else {
      await rpc.call("herdr.call", { method: "workspace.rename", params: { workspace_id: t.workspace_id, label: value } });
    }
    return true;
  } catch (e) {
    // Put back the old name only where it is still ours: an event may have changed it since.
    patchStore(hostId, (s) => (currentName(s, kind, t) === value ? withName(s, kind, t, before || null) : s));
    if (isUnknownMethod(e)) {
      markMissing(hostId, RENAME_METHOD[kind]);
      throw new RpcError("unknown_method", "This host's herdr can't rename that.");
    }
    throw e;
  }
}

const PROMPT_TEXT: Record<RenameKind, string> = {
  session: "Lowercase letters, digits, - or _. Start with a letter. Empty removes the name.",
  tab: "The tab name in herdr.",
  workspace: "The workspace name in herdr.",
};

/** Native prompt with the current name; sends the rename and reports the result. */
export function promptRename(rpc: Rpc, hostId: string, kind: RenameKind, t: RenameTarget): void {
  const snap = useSnapshots.getState().byHost[hostId];
  const current = snap ? currentName(snap, kind, t) : "";
  Alert.prompt(
    RENAME_LABEL[kind],
    PROMPT_TEXT[kind],
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: (text?: string) => {
          rename(rpc, hostId, kind, t, text ?? "").then(
            (sent) => sent && haptics.commit(),
            (e) => {
              haptics.fail();
              Alert.alert("Can't rename", e instanceof Error ? e.message : String(e));
            },
          );
        },
      },
    ],
    "plain-text",
    current,
  );
}

export type MenuItem = { label: string; destructive?: boolean; onPick: () => void };

/** Rename items for one agent, without the ones its host does not support. */
export function renameItems(rpc: Rpc, hostId: string, t: RenameTarget, kinds: RenameKind[] = ["session", "tab", "workspace"]): MenuItem[] {
  return kinds.filter((k) => renameSupported(hostId, k)).map((k) => ({ label: RENAME_LABEL[k], onPick: () => promptRename(rpc, hostId, k, t) }));
}
