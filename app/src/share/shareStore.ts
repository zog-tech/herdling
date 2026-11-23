/**
 * The share that waits for the share screen. The share bridge puts it here when another app shares
 * to Herdling; the share screen reads it and clears it after the send. In memory only.
 */
import { create } from "zustand";

import type { SharedContent } from "./content";
import type { ShareTarget } from "./shareMachine";

type ShareStore = {
  content?: SharedContent;
  /** Bumped for each new share: the share screen starts again with an empty note. */
  seq: number;
  /** The agent of the last send. The next share selects it first. */
  lastTarget?: ShareTarget;
};

export const useShareStore = create<ShareStore>(() => ({ seq: 0 }));

/** A new share from another app. It replaces a share that was not sent. */
export function receiveShare(content: SharedContent): void {
  useShareStore.setState((s) => ({ content, seq: s.seq + 1 }));
}

/** The share was sent or dropped. `target`: the agent that got it. */
export function clearShareContent(target?: ShareTarget): void {
  useShareStore.setState((s) => ({ content: undefined, lastTarget: target ?? s.lastTarget }));
}
