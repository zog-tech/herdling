import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";

import * as haptics from "@/ui/haptics";
import { showActionSheet } from "@/ui/nativeSheet";
import { showNotice } from "@/ui/notice";

import type { ThreadPane } from "./LiveToolContext";
import { plainText } from "./plainText";
import { requestQuote } from "./quote";
import { openSelectText } from "./selectText";
import { fullInputText, type ToolResult } from "./toolView";

/**
 * The long-press menu of a thread row, like the chat apps: Copy, Select text, Share and more.
 * `rowActions` is the pure rule (which items a row gets); `runRowAction` does the I/O.
 * iOS shows the system action sheet; Android shows the sheet of `NativeSheetHost`.
 */

/** Loaded on first use: the speech module loads the native voice module, which rows do not need. */
const speech = () => require("@/voice/useSpeakReplies") as typeof import("@/voice/useSpeakReplies");

export type RowKind = "user" | "assistant" | "thinking" | "tool" | "subagent" | "system";

/** What a long press acts on. `text` is the markdown source for a reply, the plain text otherwise. */
export type MenuTarget = {
  kind: RowKind;
  text: string;
  /** Thread item id of a reply: it tells which reply speaks now. */
  id?: string;
  /** The code of the code block under the finger, inside a reply. */
  code?: string;
};

export type RowAction = "copyCode" | "copy" | "copyMarkdown" | "select" | "share" | "read" | "quote";

/** What a reader sees: a reply without its markdown marks. Other rows are plain already. */
export function readableText(t: MenuTarget): string {
  return t.kind === "assistant" ? plainText(t.text) : t.text;
}

/**
 * The menu items of a row, in menu order. Read aloud and Quote need a live pane (a session thread);
 * Read aloud is only for replies, the same as the play button under a reply.
 */
export function rowActions(t: MenuTarget, pane: ThreadPane | null): RowAction[] {
  const out: RowAction[] = [];
  if (t.code !== undefined) out.push("copyCode");
  out.push("copy");
  // Only offered when the reply has markdown marks; otherwise both copies are the same.
  if (t.kind === "assistant" && plainText(t.text) !== t.text.trim()) out.push("copyMarkdown");
  if (t.kind === "system") return out;
  out.push("select");
  if (t.kind !== "user" && t.kind !== "assistant") return out;
  out.push("share");
  if (pane && t.kind === "assistant" && t.id) out.push("read");
  if (pane) out.push("quote");
  return out;
}

export function actionLabel(a: RowAction, t: MenuTarget): string {
  switch (a) {
    case "copyCode":
      return "Copy code";
    case "copy":
      return "Copy";
    case "copyMarkdown":
      return "Copy as Markdown";
    case "select":
      return "Select text";
    case "share":
      return "Share";
    case "read":
      return t.id !== undefined && speech().useManualSpeech.getState().key === t.id ? "Stop reading" : "Read aloud";
    case "quote":
      return "Quote in reply";
  }
}

const SELECT_TITLE: Record<RowKind, string> = {
  user: "Your message",
  assistant: "Reply",
  thinking: "Thinking",
  tool: "Tool call",
  subagent: "Subagent",
  system: "Note",
};

/** The copy text of a tool card: the same layout as Copy in the full tool view. */
export function toolCopyText(name: string, input: unknown, result?: ToolResult): string {
  const head = `${name}\n\nInput:\n${fullInputText(input) || "(none)"}`;
  if (!result) return head;
  return `${head}\n\n${result.ok ? "Result" : "Error"}:\n${result.text || "(empty)"}`;
}

/** The copy text of a subagent card: its description and its visible summary. */
export function subagentCopyText(description: string, summary?: string): string {
  return [description || "Subagent", summary?.trim()].filter(Boolean).join("\n\n");
}

/** Copies the text, then gives one haptic and a short "Copied" notice. */
export async function copyText(text: string, done = "Copied"): Promise<void> {
  try {
    await Clipboard.setStringAsync(text);
    haptics.commit();
    showNotice(done);
  } catch {
    haptics.fail();
    showNotice("Can't copy", { failed: true });
  }
}

export function runRowAction(a: RowAction, t: MenuTarget, pane: ThreadPane | null): void {
  switch (a) {
    case "copyCode":
      void copyText(t.code ?? "", "Code copied");
      return;
    case "copy":
      void copyText(readableText(t));
      return;
    case "copyMarkdown":
      void copyText(t.text, "Markdown copied");
      return;
    case "select":
      openSelectText({ title: SELECT_TITLE[t.kind], text: readableText(t) });
      return;
    case "share":
      Share.share({ message: readableText(t) }).catch(() => {});
      return;
    case "read":
      // A second call for the reply that speaks now stops it, the same as the play button.
      if (pane && t.id) void speech().speakReplyNow(pane.hostId, t.text, t.id);
      return;
    case "quote":
      if (pane) requestQuote(pane.hostId, pane.paneId, t.text);
      return;
  }
}

/** Opens the menu of a row. A dismiss does nothing. */
export function openRowMenu(t: MenuTarget, pane: ThreadPane | null): void {
  const actions = rowActions(t, pane);
  const options = [...actions.map((a) => actionLabel(a, t)), "Cancel"];
  showActionSheet({ options, cancelButtonIndex: actions.length }, (i) => {
    const a = actions[i];
    if (a) runRowAction(a, t, pane);
  });
}
