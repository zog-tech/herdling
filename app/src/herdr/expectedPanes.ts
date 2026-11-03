/**
 * Expected panes: what the app itself just started in a pane, before the snapshot shows it.
 *
 * The snapshot can lag after New session, restart or resume: it can show the new pane before its
 * agent, and the session screen would show a terminal for a moment. A pane that the app marks
 * "agent" keeps the agent layout (the starting state) until the agent appears. A pane marked
 * "shell" shows the terminal at once, also in the detail column, where no route hint arrives.
 * A mark goes away when the snapshot confirms it, or after `EXPECT_MS`.
 */
import { useEffect } from "react";
import { create } from "zustand";

export type ExpectedKind = "agent" | "shell";

/** How long a mark holds when the snapshot does not confirm it. */
export const EXPECT_MS = 45_000;

type Entry = { kind: ExpectedKind; until: number };

const key = (hostId: string, paneId: string) => `${hostId}:${paneId}`;

const useExpected = create<{ byPane: Record<string, Entry> }>(() => ({ byPane: {} }));

/** Marks `paneId` on `hostId`: the app just started an agent or a shell in it. */
export function expectPane(hostId: string, paneId: string, kind: ExpectedKind, now = Date.now()): void {
  useExpected.setState((s) => ({ byPane: { ...s.byPane, [key(hostId, paneId)]: { kind, until: now + EXPECT_MS } } }));
}

/** Removes the mark of the pane, for example when the snapshot shows what the mark expected. */
export function clearExpected(hostId: string, paneId: string): void {
  const k = key(hostId, paneId);
  if (!(k in useExpected.getState().byPane)) return;
  useExpected.setState((s) => {
    const { [k]: _gone, ...rest } = s.byPane;
    return { byPane: rest };
  });
}

/** The live mark of the pane, or undefined when there is none or it expired. */
export function expectedKind(hostId: string, paneId: string, now = Date.now()): ExpectedKind | undefined {
  const e = useExpected.getState().byPane[key(hostId, paneId)];
  return e && e.until > now ? e.kind : undefined;
}

/** Removes every mark. For tests. */
export function resetExpected(): void {
  useExpected.setState({ byPane: {} });
}

/**
 * The live mark of the pane, as a hook. The component renders again when the mark expires.
 * `confirmed(kind)` is true when the snapshot shows what the mark expected: the mark then goes away.
 */
export function useExpectedPane(hostId: string, paneId: string, confirmed: (kind: ExpectedKind) => boolean): ExpectedKind | undefined {
  const entry = useExpected((s) => s.byPane[key(hostId, paneId)]);
  const live = entry && entry.until > Date.now() ? entry : undefined;
  const done = live ? confirmed(live.kind) : false;
  useEffect(() => {
    if (!entry) return;
    if (done) {
      clearExpected(hostId, paneId);
      return;
    }
    // Expiry removes the mark, and the store change renders the component again.
    const t = setTimeout(() => clearExpected(hostId, paneId), Math.max(0, entry.until - Date.now()));
    return () => clearTimeout(t);
  }, [entry, done, hostId, paneId]);
  return live?.kind;
}
