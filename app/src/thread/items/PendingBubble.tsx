import { CircleAlert, Clock } from "lucide-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { useHostConn } from "@/hosts/connection";
import { colors, hitTarget, space, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";

import { removePending, sendWithPending, usePendingList, type Pending } from "../pending";
import { UserBubble } from "./UserBubble";

export function pendingLabel(p: Pick<Pending, "state">): string {
  return p.state === "sending" ? "Sending…" : p.state === "queued" ? "Queued" : "Not sent · Retry";
}

/** One prompt the log does not show yet: the user bubble, dimmed, with its state under it. */
export const PendingBubble = memo(function PendingBubble({ hostId, paneId, p }: { hostId: string; paneId: string; p: Pending }) {
  const { rpc } = useHostConn(hostId);
  const failed = p.state === "failed";
  const label = pendingLabel(p);
  const retry = () => {
    if (!rpc) return;
    sendWithPending(rpc, hostId, paneId, p.text, p.id).then(haptics.commit, haptics.fail);
  };
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ opacity: failed ? 1 : 0.7 }}>
        <UserBubble text={p.text} />
      </View>
      {failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Not sent. ${p.error ?? ""}`.trim()}
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
          <CircleAlert size={12} color={colors.danger} />
          <Text variant="caption" bold color={colors.danger}>
            {label}
          </Text>
        </Pressable>
      ) : (
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
      )}
    </View>
  );
});

/**
 * All pending prompts of a pane, in send order. Renders nothing when there are none. Memoized:
 * the thread passes a new element on every update.
 */
export const PendingBubbles = memo(function PendingBubbles({ hostId, paneId }: { hostId: string; paneId: string }) {
  const list = usePendingList(hostId, paneId);
  if (list.length === 0) return null;
  return (
    <View style={{ gap: space.md, paddingTop: space.md }}>
      {list.map((p) => (
        <PendingBubble key={p.id} hostId={hostId} paneId={paneId} p={p} />
      ))}
    </View>
  );
});
