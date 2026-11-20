/**
 * Runs the "Send now" machine (`sendNowMachine.ts`) of each pane: keeps the state per pane, presses
 * Esc in the pane and runs the timers. The state is per pane because one Esc sends every queued prompt.
 */
import { create } from "zustand";

import type { RpcClient } from "@/rpc/RpcClient";
import { sendKey } from "@/terminal/keys";
import * as haptics from "@/ui/haptics";

import { SEND_NOW_IDLE, sendNowReducer, type SendNowEvent, type SendNowState } from "./sendNowMachine";

type Rpc = Pick<RpcClient, "call">;

type Store = { byPane: Record<string, SendNowState> };

export const useSendNowStore = create<Store>(() => ({ byPane: {} }));

const paneKey = (hostId: string, paneId: string) => `${hostId}:${paneId}`;

export function sendNowOf(hostId: string, paneId: string): SendNowState {
  return useSendNowStore.getState().byPane[paneKey(hostId, paneId)] ?? SEND_NOW_IDLE;
}

export function useSendNow(hostId: string, paneId: string): SendNowState {
  return useSendNowStore((s) => s.byPane[paneKey(hostId, paneId)] ?? SEND_NOW_IDLE);
}

/** I/O of the effects. Tests replace the key press and the timer. */
export type SendNowIo = {
  pressEsc: (rpc: Rpc, paneId: string) => Promise<void>;
  setTimer: (fn: () => void, ms: number) => void;
};

const defaultIo: SendNowIo = {
  pressEsc: (rpc, paneId) => sendKey(rpc, paneId, "esc"),
  setTimer: (fn, ms) => {
    setTimeout(fn, ms);
  },
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Sends one event to the machine of a pane and runs its effects. */
export function sendNowDispatch(rpc: Rpc, hostId: string, paneId: string, event: SendNowEvent, io: SendNowIo = defaultIo): void {
  const key = paneKey(hostId, paneId);
  const { state, effects } = sendNowReducer(sendNowOf(hostId, paneId), event);
  useSendNowStore.setState((s) => ({ byPane: { ...s.byPane, [key]: state } }));
  for (const fx of effects) {
    switch (fx.type) {
      case "pressEsc":
        io.pressEsc(rpc, paneId).then(
          () => sendNowDispatch(rpc, hostId, paneId, { type: "keyOk", gen: fx.gen }, io),
          (e) => sendNowDispatch(rpc, hostId, paneId, { type: "keyFailed", gen: fx.gen, error: message(e) }, io),
        );
        break;
      case "startTimer":
        io.setTimer(() => sendNowDispatch(rpc, hostId, paneId, { type: "timer", gen: fx.gen }, io), fx.ms);
        break;
      case "haptic":
        if (fx.kind === "commit") haptics.commit();
        else haptics.fail();
        break;
    }
  }
}
