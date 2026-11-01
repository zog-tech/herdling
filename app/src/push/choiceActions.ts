import type { PaneAnswer, PaneAnswerParams } from "@herdling/protocol";
import * as Notifications from "expo-notifications";

import { retryNow, waitForRpc } from "@/hosts/connection";
import type { RpcClient } from "@/rpc/RpcClient";
import { showNotice } from "@/ui/notice";

import { CHOICE_CATEGORY, CHOICE_NO, CHOICE_YES } from "./choiceIds";
import { dismissPaneNotifications } from "./dismiss";

/**
 * Yes and No buttons on a "needs you" push (Stage 1a). herdlingd sends `categoryId: "herdling_choice"`
 * and `data.choice` to a device that registered `choice_actions`. A tap on a button opens the app;
 * the app connects to the host, opens the session and answers with `pane.answer`, which checks
 * the menu on the computer again.
 */

export { CHOICE_CATEGORY, CHOICE_NO, CHOICE_YES } from "./choiceIds";

/** Time to wait for the host connection after the tap. */
const CONNECT_MS = 20_000;
/** A ping that takes longer than this counts as a dead connection: the app connects again. */
const PING_MS = 4_000;
const ANSWER_MS = 15_000;

/**
 * Registers the `herdling_choice` category. Titles are fixed ("Yes", "No"); the push body shows the
 * full labels. Both actions open the app and need Face ID or the passcode on a locked phone.
 * Never throws.
 */
export async function registerChoiceCategory(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(CHOICE_CATEGORY, [
      { identifier: CHOICE_YES, buttonTitle: "Yes", options: { opensAppToForeground: true, isAuthenticationRequired: true } },
      {
        identifier: CHOICE_NO,
        buttonTitle: "No",
        options: { opensAppToForeground: true, isDestructive: true, isAuthenticationRequired: true },
      },
    ]);
  } catch (e) {
    console.warn("[push] choice category failed:", e instanceof Error ? e.message : String(e));
  }
}

/** What a tap on a choice button asks for. `answer` is the button: "Yes" or "No". */
export type ChoiceTap = { hostId: string; paneId: string; key: string; label: string; answer: "Yes" | "No" };

const isOption = (v: unknown): v is { key: string; label: string } =>
  typeof v === "object" && v !== null && typeof (v as { key?: unknown }).key === "string" && typeof (v as { label?: unknown }).label === "string";

/** The answer of a notification response, or null when it is not a tap on a choice button or the data has another shape. */
export function choiceTap(actionIdentifier: string, data: unknown): ChoiceTap | null {
  const answer = actionIdentifier === CHOICE_YES ? "Yes" : actionIdentifier === CHOICE_NO ? "No" : null;
  if (!answer || typeof data !== "object" || data === null) return null;
  const { hostId, paneId, choice } = data as { hostId?: unknown; paneId?: unknown; choice?: unknown };
  if (typeof hostId !== "string" || typeof paneId !== "string" || !hostId || !paneId) return null;
  if (typeof choice !== "object" || choice === null) return null;
  const option = (choice as { yes?: unknown; no?: unknown })[answer === "Yes" ? "yes" : "no"];
  if (!isOption(option) || !/^[1-9]$/.test(option.key)) return null;
  return { hostId, paneId, key: option.key, label: option.label, answer };
}

export type AnswerResult = "answered" | "stale" | "failed";

type Rpc = Pick<RpcClient, "call">;

export type AnswerDeps = {
  /** The host's rpc client once it is online, or undefined. `fresh` asks for a new connection. */
  connect: (hostId: string, fresh: boolean) => Promise<Rpc | undefined>;
  notice: (text: string, o?: { failed?: boolean }) => void;
  /** Removes the delivered notifications of the pane after an answer. */
  dismiss?: (hostId: string, paneId: string) => Promise<unknown>;
};

/** A live connection: the current one when it answers a ping, else a new one. */
async function connectLive(hostId: string, fresh: boolean): Promise<Rpc | undefined> {
  if (!fresh) return waitForRpc(hostId, CONNECT_MS);
  const attempt = retryNow(hostId);
  return attempt === undefined ? undefined : waitForRpc(hostId, CONNECT_MS, attempt);
}

const defaultDeps: AnswerDeps = { connect: connectLive, notice: showNotice, dismiss: dismissPaneNotifications };

/**
 * Answers the menu of `tap` with `pane.answer` and shows the result: "Answered Yes", "The question changed"
 * (error `stale`) or a failure. After the app was in the background the old connection can be dead,
 * so a ping checks it first and a failed ping connects again. `pane.answer` itself is sent once.
 * After the answer, the notifications of the pane go away: the user handled them.
 */
export async function answerChoiceTap(tap: ChoiceTap, deps: AnswerDeps = defaultDeps): Promise<AnswerResult> {
  let rpc = await deps.connect(tap.hostId, false);
  if (rpc) {
    try {
      await rpc.call("ping", {}, PING_MS);
    } catch {
      rpc = await deps.connect(tap.hostId, true);
    }
  }
  if (!rpc) {
    deps.notice("Could not reach the computer", { failed: true });
    return "failed";
  }
  const params: PaneAnswerParams = { pane_id: tap.paneId, key: tap.key, expect_label: tap.label };
  try {
    await rpc.call<PaneAnswer>("pane.answer", params, ANSWER_MS);
    deps.notice(`Answered ${tap.answer}`);
    void deps.dismiss?.(tap.hostId, tap.paneId);
    return "answered";
  } catch (e) {
    if ((e as { code?: unknown })?.code === "stale") {
      deps.notice("The question changed", { failed: true });
      return "stale";
    }
    deps.notice("Could not answer. Answer in the session.", { failed: true });
    return "failed";
  }
}
