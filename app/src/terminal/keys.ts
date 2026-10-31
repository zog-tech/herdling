import type { RpcClient } from "@/rpc/RpcClient";

import type { SendOp } from "./sendQueue";

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

/** Connections whose herdr has no `pane.send_input` (an older herdr). */
const noSendInput = new WeakSet<object>();
/** Connections where `pane.send_input` worked at least once. */
const sendInputOk = new WeakSet<object>();

/** True when `pane.send_input` worked on this connection, so one item is one call. */
export function sendInputWorks(rpc: object): boolean {
  return sendInputOk.has(rpc);
}

/** herdr without the method answers `invalid_request` ("unknown variant"); a fake or a proxy can say `unknown_method`. */
function missingMethod(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "unknown_method" || code === "invalid_request";
}

/**
 * Types `op.text` into the pane, then presses `op.keys`, with one herdr `pane.send_input`.
 * When herdr does not know that method, it uses `pane.send_text` and `pane.send_keys`, and
 * remembers that for the connection. No keys are pressed when the text fails.
 */
export async function sendInput(rpc: Rpc, paneId: string, op: SendOp): Promise<void> {
  if (!noSendInput.has(rpc)) {
    try {
      await rpc.call("herdr.call", { method: "pane.send_input", params: { pane_id: paneId, ...op } });
      sendInputOk.add(rpc);
      return;
    } catch (e) {
      if (!missingMethod(e) || sendInputOk.has(rpc)) throw e;
      noSendInput.add(rpc);
    }
  }
  if (op.text) await rpc.call("herdr.call", { method: "pane.send_text", params: { pane_id: paneId, text: op.text } });
  if (op.keys?.length) await rpc.call("herdr.call", { method: "pane.send_keys", params: { pane_id: paneId, keys: op.keys } });
}

/** Presses one key in the pane. */
export function sendKey(rpc: Rpc, paneId: string, key: string): Promise<void> {
  return sendInput(rpc, paneId, { keys: [key] });
}

/** Types `text` literally into the pane, then presses Enter. No Enter when the text fails. */
export function sendLine(rpc: Rpc, paneId: string, text: string): Promise<void> {
  return sendInput(rpc, paneId, { text, keys: ["enter"] });
}
