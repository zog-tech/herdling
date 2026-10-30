import type { RpcClient } from "@/rpc/RpcClient";

type Rpc = Pick<RpcClient, "call">;

/** Key row buttons, left to right, with herdr `pane.send_keys` key names. */
export const KEYS: readonly { label: string; key: string }[] = [
  { label: "Esc", key: "esc" },
  { label: "Tab", key: "tab" },
  { label: "Ctrl-C", key: "ctrl+c" },
  { label: "Up", key: "up" },
  { label: "Down", key: "down" },
  { label: "Left", key: "left" },
  { label: "Right", key: "right" },
  { label: "Enter", key: "enter" },
];

/** Presses one key in the pane (herdr `pane.send_keys`). */
export async function sendKey(rpc: Rpc, paneId: string, key: string): Promise<void> {
  await rpc.call("herdr.call", { method: "pane.send_keys", params: { pane_id: paneId, keys: [key] } });
}

/** Types `text` literally into the pane (`pane.send_text`), then presses Enter. No Enter when the text fails. */
export async function sendLine(rpc: Rpc, paneId: string, text: string): Promise<void> {
  await rpc.call("herdr.call", { method: "pane.send_text", params: { pane_id: paneId, text } });
  await sendKey(rpc, paneId, "enter");
}
