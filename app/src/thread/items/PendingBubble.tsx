import { ArrowUp, CircleAlert, Clock } from "lucide-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";

import { useHostConn } from "@/hosts/connection";
import { useSnapshots } from "@/herdr/snapshotStore";
import { colors, hitTarget, motion, space, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";

import { canRetry, pendingLabel, removePending, sendWithPending, splitUploads, usePendingList, type Pending } from "../pending";
import { sendNowDispatch, useSendNow } from "../sendNow";
import { sendNowLabel, showsSendNow } from "../sendNowMachine";
import { UserBubble } from "./UserBubble";

/** A new state line fades in over the old one's place: Sending → Queued → No reply or Not sent. Opacity only. */
const FADE_IN = { from: { opacity: 0 }, to: { opacity: 1 } };
const FADE_EASE = cubicBezier(...motion.ease.out);
const fadeIn = { animationName: FADE_IN, animationDuration: motion.crossfadeMs, animationTimingFunction: FADE_EASE } as const;

/**
 * One prompt the log does not show yet: the user bubble, dimmed, with its state under it.
 * `sendNow`: the bubble waits in the queue of a working Claude Code pane, so it shows "Send now".
 */
export const PendingBubble = memo(function PendingBubble({
  hostId,
  paneId,
  p,
  sendNow = false,
}: {
  hostId: string;
  paneId: string;
  p: Pending;
  sendNow?: boolean;
}) {
  const { rpc } = useHostConn(hostId);
  const retryable = canRetry(p);
  /** A timeout: the prompt can still arrive, so a softer color than a refused send. */
  const unconfirmed = p.state === "unconfirmed";
  const tone = unconfirmed ? colors.status.blocked : colors.danger;
  const label = pendingLabel(p);
  // The photo paths at the end show as "N images", as in a delivered bubble.
  const shown = splitUploads(p.text);
  const retry = () => {
    if (!rpc) return;
    sendWithPending(rpc, hostId, paneId, p.text, p.id).then(haptics.commit, haptics.fail);
  };
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ opacity: retryable ? 1 : 0.7 }}>
        <UserBubble text={shown.text} images={shown.images || undefined} />
      </View>
      {/* Keyed by state: each change mounts the new line, which fades in. */}
      <Animated.View key={p.state} style={fadeIn}>
      {retryable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unconfirmed ? "No reply. The prompt can still arrive." : `Not sent. ${p.error ?? ""}`.trim()}
          accessibilityHint="Sends it again. Long press removes it."
          accessibilityActions={[{ name: "activate" }, { name: "remove", label: "Remove" }]}
          onAccessibilityAction={(e) => (e.nativeEvent.actionName === "remove" ? removePending(hostId, paneId, p.id) : retry())}
          onPress={retry}
          onLongPress={() => removePending(hostId, paneId, p.id)}
          disabled={!rpc}
          hitSlop={8}
          style={({ pressed }) => ({
            alignSelf: "flex-end",
            minHeight: hitTarget - 16,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <CircleAlert size={12} color={tone} />
          <Text variant="caption" bold color={tone}>
            {label}
          </Text>
        </Pressable>
      ) : (
        <View style={{ alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: space.md }}>
          {sendNow ? <SendNowAction hostId={hostId} paneId={paneId} /> : null}
          <View
          accessible
          accessibilityLabel={`Your message, ${label}`}
          style={{ alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: space.xs }}
        >
          {p.state === "queued" ? <Clock size={12} color={colors.textMuted} /> : null}
          <Text variant="caption" muted>
            {label}
          </Text>
          </View>
        </View>
      )}
      </Animated.View>
    </View>
  );
});

/**
 * "Send now" next to the state line of a queued prompt: one Esc stops the turn, and Claude Code
 * sends its queued prompts at once (`sendNowMachine.ts`). The flow is per pane, so every queued
 * bubble of the pane shows the same state.
 */
function SendNowAction({ hostId, paneId }: { hostId: string; paneId: string }) {
  const { rpc } = useHostConn(hostId);
  const flow = useSendNow(hostId, paneId);
  const busy = sendNowLabel(flow);
  if (flow.phase === "sending" || flow.phase === "sent") {
    return (
      <Text variant="caption" muted accessibilityLiveRegion="polite">
        {busy}
      </Text>
    );
  }
  const failed = flow.phase === "failed";
  const tap = () => {
    if (!rpc) return;
    // The status at the tap: the agent can finish between the render and the tap.
    const working = useSnapshots.getState().byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent_status === "working";
    sendNowDispatch(rpc, hostId, paneId, { type: "tap", working });
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={failed ? `${busy}. Send now` : "Send now"}
      accessibilityHint="Stops the current turn. The agent then gets the queued messages."
      onPress={tap}
      disabled={!rpc}
      hitSlop={8}
      style={({ pressed }) => ({
        minHeight: hitTarget - 16,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      {failed ? <CircleAlert size={12} color={colors.danger} /> : <ArrowUp size={12} color={colors.text} />}
      <Text variant="caption" bold color={failed ? colors.danger : colors.text}>
        {failed ? `${busy} · Retry` : "Send now"}
      </Text>
    </Pressable>
  );
}

/**
 * All pending prompts of a pane, in send order. Renders nothing when there are none. Memoized:
 * the thread passes a new element on every update.
 */
export const PendingBubbles = memo(function PendingBubbles({ hostId, paneId }: { hostId: string; paneId: string }) {
  const list = usePendingList(hostId, paneId);
  const kind = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent);
  const status = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent_status);
  const flow = useSendNow(hostId, paneId);
  if (list.length === 0) return null;
  // One "Send now" for the pane, on the newest queued bubble. A running flow keeps its line while the status changes.
  const at = list.findLastIndex((p) => p.state === "queued" && (flow.phase !== "idle" || showsSendNow(kind, status, p.state)));
  return (
    <View style={{ gap: space.md, paddingTop: space.md }}>
      {list.map((p, i) => (
        <PendingBubble key={p.id} hostId={hostId} paneId={paneId} p={p} sendNow={i === at} />
      ))}
    </View>
  );
});
