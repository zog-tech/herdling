import { MailOpen, Reply, RotateCcw } from "lucide-react-native";
import { memo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated from "react-native-reanimated";

import { colors, hitTarget, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { BUCKET_LABEL, type BoardItem } from "./buckets";
import { BUCKET_META, kindIcon } from "./bucketMeta";
import { StatusPill } from "./StatusPill";

const ACTION_W = 84;
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
type Actions = {
  onOpen: (item: BoardItem) => void;
  onPeek: (item: BoardItem) => void;
  onMarkRead: (item: BoardItem) => void;
  onReply: (item: BoardItem) => void;
  onRestart: (item: BoardItem) => void;
};

function SwipeAction({
  label,
  color,
  Icon,
  onPress,
}: {
  label: string;
  color: string;
  Icon: typeof Reply;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        width: ACTION_W,
        minHeight: hitTarget,
        alignItems: "center",
        justifyContent: "center",
        gap: space.xs,
        backgroundColor: color,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Icon size={20} color={colors.bg} />
      <Text variant="caption" bold color={colors.bg}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One agent on the Board. Tap opens the session, long-press peeks. Swipe right marks it read;
 * swipe left reveals Reply and Restart. VoiceOver gets the same actions as custom actions.
 */
export const AgentCard = memo(function AgentCard({ item, now, ...actions }: { item: BoardItem; now: number } & Actions) {
  const swipe = useRef<SwipeableMethods>(null);
  const [pressed, setPressed] = useState(false);
  const { agent, bucket } = item;
  const { color } = BUCKET_META[bucket];
  const KindIcon = kindIcon(agent.agent);
  const title = agent.terminal_title_stripped || agent.agent;
  const unread = bucket === "ready";
  const flagged = bucket === "needs_you" || bucket === "ready";
  const close = () => swipe.current?.close();

  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={1.5}
      leftThreshold={ACTION_W * 0.8}
      rightThreshold={ACTION_W * 0.6}
      overshootLeft={false}
      overshootRight={false}
      containerStyle={{ borderRadius: radius.lg, backgroundColor: colors.muted }}
      onSwipeableOpen={(dir) => {
        // Swiping right opens the left panel: that is "mark read", done on release.
        if (dir === SwipeDirection.RIGHT) {
          actions.onMarkRead(item);
          close();
        }
      }}
      renderLeftActions={() => <SwipeAction label="Read" color={colors.status.idle} Icon={MailOpen} />}
      renderRightActions={() => (
        <View style={{ flexDirection: "row" }}>
          <SwipeAction
            label="Reply"
            color={colors.status.working}
            Icon={Reply}
            onPress={() => {
              close();
              actions.onReply(item);
            }}
          />
          <SwipeAction
            label="Restart"
            color={colors.danger}
            Icon={RotateCcw}
            onPress={() => {
              close();
              actions.onRestart(item);
            }}
          />
        </View>
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${BUCKET_LABEL[bucket]}${unread ? ", unread" : ""}`}
        accessibilityHint="Opens the session. Long press to peek."
        accessibilityActions={[
          { name: "activate" },
          { name: "longpress", label: "Peek" },
          { name: "markRead", label: "Mark read" },
          { name: "reply", label: "Reply" },
          { name: "restart", label: "Restart" },
        ]}
        onAccessibilityAction={(e) => {
          const a = e.nativeEvent.actionName;
          if (a === "activate") actions.onOpen(item);
          else if (a === "longpress") actions.onPeek(item);
          else if (a === "markRead") actions.onMarkRead(item);
          else if (a === "reply") actions.onReply(item);
          else if (a === "restart") actions.onRestart(item);
        }}
        onPress={() => actions.onOpen(item)}
        onLongPress={() => actions.onPeek(item)}
        delayLongPress={350}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
      >
        <Animated.View
          style={{
            flexDirection: "row",
            gap: space.md,
            padding: space.md,
            paddingLeft: space.md + 3,
            minHeight: hitTarget + space.lg,
            backgroundColor: pressed ? colors.muted : colors.card,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.muted,
            overflow: "hidden",
            transform: [{ scale: pressed ? 0.98 : 1 }],
            transitionProperty: ["transform", "backgroundColor"],
            transitionDuration: 120,
            transitionTimingFunction: EASE_OUT,
          }}
        >
          {/* Accent edge for cards that want attention; the pill still carries icon + label. */}
          {flagged ? (
            <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: color }} />
          ) : null}
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.md,
              backgroundColor: colors.muted,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <KindIcon size={18} color={colors.text} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              {unread ? (
                <View
                  accessibilityElementsHidden
                  style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.status.idle }}
                />
              ) : null}
              <Text bold numberOfLines={1} style={{ flex: 1 }}>
                {title}
              </Text>
              <StatusPill item={item} now={now} />
            </View>
            <Text variant="caption" muted numberOfLines={1}>
              {`${item.hostName} · ${item.workspace}`}
            </Text>
            {item.line ? (
              <Text
                variant="small"
                numberOfLines={2}
                color={bucket === "needs_you" ? colors.status.blocked : bucket === "idle" ? colors.textMuted : colors.text}
                mono={bucket === "working"}
              >
                {item.line}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      </Pressable>
    </ReanimatedSwipeable>
  );
});
