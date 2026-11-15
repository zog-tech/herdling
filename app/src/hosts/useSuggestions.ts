import type { MachinesSuggest } from "@herdling/protocol";
import { useEffect, useReducer, useRef } from "react";

import { getHostConn, useOnlineHostKey } from "./connection";
import { listsMethod } from "./methods";
import { useHosts } from "./store";
import { mergeSuggestions, SUGGEST_START, suggestReducer, type SuggestState } from "./suggest";

const SUGGEST_TIMEOUT_MS = 10_000;

/**
 * The suggested computers while `active`: asks each online paired computer that lists
 * `machines.suggest`. An older herdlingd is skipped. With no such computer the state stays idle.
 */
export function useSuggestions(active: boolean): SuggestState {
  const hosts = useHosts((s) => s.hosts);
  const online = useOnlineHostKey(hosts.map((h) => h.id));
  const [state, dispatch] = useReducer(suggestReducer, SUGGEST_START);
  const gen = useRef(state.gen);
  gen.current = state.gen;

  useEffect(() => {
    const askers = online
      .split(",")
      .filter(Boolean)
      .flatMap((id) => {
        const conn = getHostConn(id);
        const host = hosts.find((h) => h.id === id);
        return conn.rpc && host && listsMethod(conn.hello, "machines.suggest") ? [{ host, rpc: conn.rpc }] : [];
      });
    if (!active || askers.length === 0) {
      dispatch({ type: "reset" });
      return;
    }
    // The generation of the load below: `load` adds one.
    const mine = gen.current + 1;
    dispatch({ type: "load" });
    void Promise.allSettled(
      askers.map(({ host, rpc }) =>
        rpc
          .call<MachinesSuggest>("machines.suggest", {}, SUGGEST_TIMEOUT_MS)
          .then((r) => ({ hostName: host.name, suggestions: Array.isArray(r?.suggestions) ? r.suggestions : [] })),
      ),
    ).then((results) => {
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (ok.length === 0) {
        const first = results.find((r) => r.status === "rejected");
        dispatch({ type: "failed", gen: mine, error: first?.status === "rejected" ? String((first.reason as Error)?.message ?? first.reason) : "no answer" });
      } else {
        dispatch({ type: "loaded", gen: mine, list: mergeSuggestions(ok, hosts) });
      }
    });
  }, [active, online, hosts]);

  return state;
}
