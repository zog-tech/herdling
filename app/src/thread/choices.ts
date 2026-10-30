import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";

/** One numbered option of an agent's permission menu. */
export type Choice = { key: string /* "1".."9" */; label: string; selected: boolean };

const NONE: Choice[] = [];
const SCAN_LINES = 20;
const REFRESH_MS = 1_000;
const BOX_EDGES = /^[\s│╭╮╰╯─]+|[\s│╭╮╰╯─]+$/g;
const CHOICE_LINE = /^\s*(?:([❯›>])\s*)?(\d)\.\s+(.+?)\s*$/;

/**
 * Numbered choices of a permission menu on the visible screen, or `[]`.
 * Looks only at the last 20 non-empty lines and takes the last block of consecutive choice lines.
 * The block counts only when it runs 1..n (n ≥ 2) and exactly one line carries the selection marker.
 */
export function parseChoices(screen: string): Choice[] {
  const lines = screen
    .split(/\r?\n/)
    .map((l) => l.replace(BOX_EDGES, ""))
    .filter((l) => l.length > 0)
    .slice(-SCAN_LINES);

  let block: Choice[] = [];
  let current: Choice[] = [];
  for (const line of lines) {
    const m = CHOICE_LINE.exec(line);
    if (m) {
      current.push({ key: m[2], label: m[3], selected: !!m[1] });
    } else if (current.length) {
      block = current;
      current = [];
    }
  }
  if (current.length) block = current;

  if (block.length < 2) return NONE;
  if (!block.every((c, i) => c.key === String(i + 1))) return NONE;
  if (block.filter((c) => c.selected).length !== 1) return NONE;
  return block;
}

/** Key of the last choice whose label starts with the word "No"; it gets the destructive style. */
export function destructiveKey(choices: Choice[]): string | undefined {
  for (let i = choices.length - 1; i >= 0; i--) {
    if (/^No\b/.test(choices[i].label)) return choices[i].key;
  }
  return undefined;
}

function sameChoices(a: Choice[], b: Choice[]): boolean {
  return a.length === b.length && a.every((c, i) => c.key === b[i].key && c.label === b[i].label && c.selected === b[i].selected);
}

/** Choices on a pane's visible screen (`pane.read`), read every 1 s while `blocked` and the app is in the foreground. */
export function useChoices(hostId: string, paneId: string, blocked: boolean): Choice[] {
  const { rpc } = useHostConn(hostId);
  const [choices, setChoices] = useState<Choice[]>(NONE);
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setChoices(NONE);
    if (!rpc || !blocked || !active) return;
    let dead = false;
    let busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await rpc.call<{ read?: { text?: string } }>("herdr.call", {
          method: "pane.read",
          params: { pane_id: paneId, source: "visible", format: "text" },
        });
        if (dead) return;
        const next = parseChoices(r.read?.text ?? "");
        // Same menu as before: keep the old array so the composer does not re-render every second.
        setChoices((prev) => (sameChoices(prev, next) ? prev : next));
      } catch {
        // Keep the last choices; the next tick retries. With none, the composer shows the blocked message.
      } finally {
        busy = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [rpc, hostId, paneId, blocked, active]);

  return choices;
}
