import type { RpcClient } from "@/rpc/RpcClient";

import { CORE_ID_PREFIX } from "@/herdr/backend";

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

/**
 * xterm text for key names that herdr 1 may not know. A herdr 1 pane that refuses the key name
 * gets this text, which herdr 1 types literally. A Herdr 2 pane knows every name.
 */
export const KEY_FALLBACK_TEXT: Readonly<Record<string, string>> = {
  "shift+tab": "\x1b[Z",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  delete: "\x1b[3~",
  insert: "\x1b[2~",
  f1: "\x1bOP",
  f2: "\x1bOQ",
  f3: "\x1bOR",
  f4: "\x1bOS",
  f5: "\x1b[15~",
  f6: "\x1b[17~",
  f7: "\x1b[18~",
  f8: "\x1b[19~",
  f9: "\x1b[20~",
  f10: "\x1b[21~",
  f11: "\x1b[23~",
  f12: "\x1b[24~",
};

/** Error codes of the phone side (no answer from the computer): never a refusal of the key. */
const LOCAL_CODES = new Set(["disconnected", "timeout", "offline"]);

/** The fallback text for keys only, when every key has one. */
export function keyFallbackText(op: SendOp): string | undefined {
  if (op.text || !op.keys?.length) return undefined;
  const parts = op.keys.map((k) => KEY_FALLBACK_TEXT[k]);
  return parts.every((p) => p !== undefined) ? parts.join("") : undefined;
}

/**
 * `sendInput`, and when the computer refuses a key name that has a fallback (`KEY_FALLBACK_TEXT`)
 * on a herdr 1 pane, the fallback text once. A phone-side error (no connection, time-out) is
 * not a refusal: it throws as before.
 */
export async function sendInputWithFallback(rpc: Rpc, paneId: string, op: SendOp): Promise<void> {
  try {
    await sendInput(rpc, paneId, op);
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    const text = paneId.startsWith(CORE_ID_PREFIX) ? undefined : keyFallbackText(op);
    if (!text || typeof code !== "string" || LOCAL_CODES.has(code)) throw e;
    await sendInput(rpc, paneId, { text });
  }
}

/** Presses one key in the pane. */
export function sendKey(rpc: Rpc, paneId: string, key: string): Promise<void> {
  return sendInput(rpc, paneId, { keys: [key] });
}

/** Types `text` literally into the pane, then presses Enter. No Enter when the text fails. */
export function sendLine(rpc: Rpc, paneId: string, text: string): Promise<void> {
  return sendInput(rpc, paneId, { text, keys: ["enter"] });
}
