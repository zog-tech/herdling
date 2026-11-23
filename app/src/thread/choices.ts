import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";

import { answerKeys, isFreeform, NONE, parseMenu, sameChoices, type Choice, type Menu } from "./parseChoices";
import {
  currentTabFromAnsi,
  cursorRows,
  parseTabBar,
  sameTabs,
  sameTitles,
  stripAnsi,
  tabKeys,
  type QuestionTabs,
  type TabMove,
} from "./questionTabs";

export { destructiveKey, parseChoices, sameChoices, type Choice, type Menu } from "./parseChoices";
export type { QuestionTabs, TabMove } from "./questionTabs";

const REFRESH_MS = 1_000;
const NO_MENU: Menu = { choices: NONE };

/** Choices on a pane's visible screen (`pane.read`), read every 1 s while `blocked` and the app is in the foreground. */
export function useChoices(hostId: string, paneId: string, blocked: boolean): Choice[] {
  return useChoiceMenu(hostId, paneId, blocked).choices;
}

/**
 * `useChoices` plus the question above the menu and the prompt context (the command) above it. `choices` keeps the same array while the menu on
 * screen stays the same, also when only the question text changes. With question tabs, another tab
 * or another question gives a new array. `tabs.current` comes from an ANSI read when the text does
 * not show it; that read runs only when the tabs or the question change.
 */
export function useChoiceMenu(hostId: string, paneId: string, blocked: boolean): Menu {
  const { rpc } = useHostConn(hostId);
  const [menu, setMenu] = useState<Menu>(NO_MENU);
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setMenu(NO_MENU);
    if (!rpc || !blocked || !active) return;
    let dead = false;
    let busy = false;
    /** The current tab found on the last ANSI read, for one tab bar and question (`tabKey`). */
    let found: { key: string; current?: number } | undefined;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await rpc.call<{ read?: { text?: string } }>("herdr.call", {
          method: "pane.read",
          params: { pane_id: paneId, source: "visible", format: "text" },
        });
        if (dead) return;
        let next = parseMenu(r.read?.text ?? "");
        if (next.tabs && next.tabs.current === undefined) {
          // The plain text does not show the current tab. Read the colors only when the tabs or the question change.
          const key = tabKey(next);
          if (found?.key !== key) found = { key, current: await readCurrentTab(rpc, paneId, next.tabs) };
          if (dead) return;
          if (found.current !== undefined) next = { ...next, tabs: { ...next.tabs, current: found.current } };
        }
        // Same menu as before: keep the old objects so the composer does not re-render every second.
        setMenu((prev) => {
          // Another question tab with the same options is another menu: the composer must show it again.
          const sameTab = !next.tabs || (sameTabs(prev.tabs, next.tabs) && prev.question === next.question);
          const same = sameChoices(prev.choices, next.choices) && sameTab;
          if (same && prev.question === next.question && prev.context === next.context && sameTabs(prev.tabs, next.tabs) && sameNext(prev, next))
            return prev;
          return { ...next, choices: same ? prev.choices : next.choices };
        });
      } catch {
        // The screen is unknown now: show no buttons (the composer shows the blocked message); the next tick retries.
        if (!dead) setMenu(NO_MENU);
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

  return menu;
}

type Rpc = { call<T>(method: string, params: unknown): Promise<T> };

/** The tab bar and the question: the current tab stays the same while this key stays the same. */
function tabKey(menu: Menu): string {
  const bar = menu.tabs!.items.map((t) => `${t.answered ? "x" : "o"}${t.title}`).join("\t");
  return `${bar}\n${menu.question ?? ""}`;
}

function sameNext(a: Menu, b: Menu): boolean {
  return a.next?.selected === b.next?.selected;
}

/**
 * The current tab from one ANSI read of the visible screen, or undefined (an error, no colors, or
 * a screen with other tabs than `tabs`).
 */
async function readCurrentTab(rpc: Rpc, paneId: string, tabs: QuestionTabs): Promise<number | undefined> {
  try {
    const r = await rpc.call<{ read?: { text?: string } }>("herdr.call", {
      method: "pane.read",
      params: { pane_id: paneId, source: "visible", format: "ansi", strip_ansi: false },
    });
    const ansi = r.read?.text ?? "";
    const bar = stripAnsi(ansi)
      .split(/\r?\n/)
      .reverse()
      .find((l) => /^\s*←\s/.test(l));
    if (!bar || !sameTitles({ items: parseTabBar(bar) }, tabs)) return undefined;
    return currentTabFromAnsi(ansi);
  } catch {
    return undefined;
  }
}

/**
 * Moves to another question tab with `pane.send_keys` (`tabKeys`): "up" off a row where the arrows
 * do nothing, then the Left or Right arrow keys, each key in its own call.
 * Re-reads the visible screen first and sends nothing ("stale") when the agent is no longer blocked
 * or the screen shows other tabs than `shown`. The current tab of `shown` counts only while the
 * screen shows the same question.
 */
export async function moveTab(rpc: Rpc, paneId: string, shown: Menu, move: TabMove, stillBlocked: () => boolean): Promise<"sent" | "stale"> {
  const r = await rpc.call<{ read?: { text?: string } }>("herdr.call", {
    method: "pane.read",
    params: { pane_id: paneId, source: "visible", format: "text" },
  });
  const now = parseMenu(r.read?.text ?? "");
  if (!stillBlocked() || !now.tabs || !sameTitles(now.tabs, shown.tabs)) return "stale";
  const current = now.tabs.current ?? (now.question === shown.question ? shown.tabs?.current : undefined);
  const rows = cursorRows(
    now.choices.map((c) => ({ selected: c.selected, checked: c.checked, freeform: isFreeform(c) })),
    now.next,
  );
  for (const key of tabKeys({ ...now.tabs, current }, rows, move)) {
    await rpc.call("herdr.call", { method: "pane.send_keys", params: { pane_id: paneId, keys: [key] } });
  }
  return "sent";
}

/**
 * Answers a permission menu with `pane.send_keys` (`answerKeys`): the bare digit of `choice` for a
 * numbered menu (no Enter), or the arrow keys from the `❯` option and Enter for a menu with no numbers.
 * Each key goes in its own call, so the agent reads each arrow key before the Enter.
 * Re-reads the visible screen first and sends nothing ("stale") when the agent is no longer blocked
 * or the menu on screen is not the one the buttons show.
 */
export async function answerChoice(
  rpc: Rpc,
  paneId: string,
  shown: Choice[],
  choice: Choice,
  stillBlocked: () => boolean,
): Promise<"sent" | "stale"> {
  const r = await rpc.call<{ read?: { text?: string } }>("herdr.call", {
    method: "pane.read",
    params: { pane_id: paneId, source: "visible", format: "text" },
  });
  const now = parseMenu(r.read?.text ?? "").choices;
  const sameMenu =
    now.length === shown.length &&
    now.every((c, i) => c.key === shown[i].key && c.label === shown[i].label && c.numbered === shown[i].numbered);
  if (!stillBlocked() || !sameMenu || !shown.some((c) => c.key === choice.key)) return "stale";
  for (const key of answerKeys(now, choice)) {
    await rpc.call("herdr.call", { method: "pane.send_keys", params: { pane_id: paneId, keys: [key] } });
  }
  return "sent";
}
