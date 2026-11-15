/**
 * Suggested computers in Add computer: the `machines.suggest` lists of the paired computers,
 * merged into one list without the computers that the app already has. The rules are pure; the
 * load is a small state machine with a generation number, so an old answer never shows.
 */
import type { MachineSuggestion } from "@herdling/protocol";

import type { Host } from "./store";

/** A suggestion and the names of the paired computers that know it. */
export type SuggestedHost = MachineSuggestion & { from: string[] };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * One list from the answers of each paired computer, in host order. The same address is one
 * entry. A suggestion with the address of a saved host is left out.
 */
export function mergeSuggestions(perHost: { hostName: string; suggestions: MachineSuggestion[] }[], saved: readonly Host[]): SuggestedHost[] {
  const out: SuggestedHost[] = [];
  for (const { hostName, suggestions } of perHost) {
    for (const s of suggestions) {
      if (!s.address || saved.some((h) => same(h.address, s.address))) continue;
      const had = out.find((o) => same(o.address, s.address));
      if (had) {
        if (!had.from.includes(hostName)) had.from.push(hostName);
        had.user ??= s.user;
        had.port ??= s.port;
        for (const src of s.sources) if (!had.sources.includes(src)) had.sources.push(src);
        continue;
      }
      out.push({ ...s, sources: [...s.sources], from: [hostName] });
    }
  }
  return out;
}

/** The text under a suggestion: where it comes from and the address. */
export function suggestionDetail(s: SuggestedHost): string {
  const via = s.sources.map((x) => (x === "core" ? "Herdr" : x === "ssh_config" ? "SSH config" : "Tailscale")).join(", ");
  const where = `${s.user ? `${s.user}@` : ""}${s.address}${s.port && s.port !== 22 ? `:${s.port}` : ""}`;
  return `${where} · ${via} on ${s.from.join(", ")}`;
}

export type SuggestState =
  | { status: "idle"; gen: number }
  | { status: "loading"; gen: number }
  | { status: "ready"; gen: number; list: SuggestedHost[] }
  | { status: "failed"; gen: number; error: string };

export type SuggestEvent =
  | { type: "load" }
  | { type: "loaded"; gen: number; list: SuggestedHost[] }
  | { type: "failed"; gen: number; error: string }
  | { type: "reset" };

export const SUGGEST_START: SuggestState = { status: "idle", gen: 0 };

/**
 * `load` starts a new attempt (the next generation). `loaded` and `failed` of an older attempt
 * change nothing. `reset` goes back to idle and drops every attempt that runs.
 */
export function suggestReducer(s: SuggestState, e: SuggestEvent): SuggestState {
  switch (e.type) {
    case "load":
      return { status: "loading", gen: s.gen + 1 };
    case "reset":
      return { status: "idle", gen: s.gen + 1 };
    case "loaded":
      return s.status === "loading" && e.gen === s.gen ? { status: "ready", gen: s.gen, list: e.list } : s;
    case "failed":
      return s.status === "loading" && e.gen === s.gen ? { status: "failed", gen: s.gen, error: e.error } : s;
  }
}
