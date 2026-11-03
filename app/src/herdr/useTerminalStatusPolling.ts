/**
 * Polls the status (idle or running) of the terminals of one host while `enabled`, the app is
 * active and the host is online. The board and the shell session screen use it. All users of one
 * host share one poll: it asks about the union of their panes, at most once every 5 s per host.
 * Callers pass only terminal panes, never agent panes.
 */
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";

import { fetchTerminalStatuses, setHostStatuses, STATUS_PANE_CAP } from "./terminalStatus";

export const STATUS_POLL_MS = 5_000;
/** Timers drift a little: a poll this close to 5 s after the last one still goes. */
const SLACK_MS = 100;

/** The panes that each active user wants, by host. */
const wanted = new Map<string, Map<symbol, string[]>>();
/** The start time of the last poll of each host. */
const lastPoll = new Map<string, number>();
/** Hosts with a poll in flight. */
const inFlight = new Set<string>();

/** The panes to ask about for a host: the union of all users, in order, at most 12. */
export function hostPanes(hostId: string): string[] {
  const all = new Set<string>();
  for (const ids of wanted.get(hostId)?.values() ?? []) for (const id of ids) all.add(id);
  return [...all].slice(0, STATUS_PANE_CAP);
}

export function useTerminalStatusPolling(hostId: string, paneIds: string[], enabled: boolean): void {
  const { rpc, status } = useHostConn(hostId);
  const online = status === "online";
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  const key = paneIds.join(",");
  useEffect(() => {
    if (!rpc || !online || !enabled || !active || !key) return;
    const me = Symbol("terminal-status");
    const users = wanted.get(hostId) ?? new Map<symbol, string[]>();
    users.set(me, key.split(","));
    wanted.set(hostId, users);
    let dead = false;
    const poll = async () => {
      if (dead || inFlight.has(hostId)) return;
      const last = lastPoll.get(hostId);
      if (last !== undefined && Date.now() - last < STATUS_POLL_MS - SLACK_MS) return;
      const panes = hostPanes(hostId);
      if (panes.length === 0) return;
      inFlight.add(hostId);
      lastPoll.set(hostId, Date.now());
      try {
        const statuses = await fetchTerminalStatuses(rpc, panes);
        setHostStatuses(hostId, panes, statuses);
      } finally {
        inFlight.delete(hostId);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), STATUS_POLL_MS);
    return () => {
      dead = true;
      clearInterval(timer);
      users.delete(me);
      if (users.size === 0) wanted.delete(hostId);
    };
  }, [rpc, online, hostId, key, enabled, active]);
}
