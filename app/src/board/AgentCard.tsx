import { Ellipsis, MailOpen, Reply, RotateCcw } from "lucide-react-native";
import { memo, useCallback, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector, useExclusiveGestures, useLongPressGesture, useTapGesture } from "react-native-gesture-handler";
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { type SharedValue, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { colors, hitTarget, motion, radius, space } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";

import type { BoardItem } from "./buckets";
import { BUCKET_META, kindIcon } from "./bucketMeta";
import { CARD_ACTIONS, cardLabel, runCardAction } from "./a11y";
import { makeCardPress } from "./cardPress";
import { StatusPill } from "./StatusPill";

const ACTION_W = 84;
/** A finger that moves further than this is a swipe or a scroll, not a press. */
const PRESS_SLOP = 10;
export type CardActions = {
  onOpen: (item: BoardItem) => void;
  onPeek: (item: BoardItem) => void;
  onMarkRead: (item: BoardItem) => void;
  onReply: (item: BoardItem) => void;
  onRestart: (item: BoardItem) => void;
  /** The "⋯" button: all actions of the card in one menu. */
  onMenu: (item: BoardItem) => void;
};

/** One peek haptic each time a swipe passes `at` points outward (the point where release acts). */
function SwipeHaptic({ drag, at }: { drag: SharedValue<number>; at: number }) {
  useAnimatedReaction(
    () => Math.abs(drag.get()) >= at,
    (past, was) => {
      if (past && was === false) scheduleOnRN(haptics.peek);
    },
  );
  return null;
}

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
 * Tap and long press of a card, with press feedback on the UI thread. Long press wins over tap
 * (exclusive); moving the finger (a swipe or a scroll) fails both and the card springs back.
 */
function useCardPress(onTap: () => void, onLong: () => void) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const overlay = useSharedValue(0);
  // The worklets call stable functions that read the newest handlers, so a Board refresh does not
  // replace the gesture callbacks while a finger is down.
  const handlers = useRef({ onTap, onLong });
  handlers.current = { onTap, onLong };
  const tapNow = useCallback(() => handlers.current.onTap(), []);
  const longNow = useCallback(() => handlers.current.onLong(), []);
  const p = useMemo(() => makeCardPress({ scale, overlay }, reduced, tapNow, longNow), [scale, overlay, reduced, tapNow, longNow]);
  const long = useLongPressGesture({
    minDuration: motion.press.longPressMs,
    maxDistance: PRESS_SLOP,
    onBegin: p.begin,
    onActivate: () => {
      "worklet";
      p.release();
      p.long();
    },
    onFinalize: p.release,
  });
  const tap = useTapGesture({ maxDistance: PRESS_SLOP, onActivate: p.tap });
  const gesture = useExclusiveGestures(long, tap);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.get() }));
  return { gesture, cardStyle, overlayStyle };
}

/**
 * One agent on the Board. Tap opens the session, long-press peeks. Swipe right marks it read;
 * swipe left reveals Reply and Restart. VoiceOver gets the same actions as custom actions.
 */
export const AgentCard = memo(function AgentCard({ item, now, ...actions }: { item: BoardItem; now: number } & CardActions) {
  const swipe = useRef<SwipeableMethods>(null);
  const { onOpen, onPeek } = actions;
  const open = useCallback(() => onOpen(item), [onOpen, item]);
  // The haptic fires at the moment the long press fires, with the spring back.
  const peek = useCallback(() => {
    haptics.peek();
    onPeek(item);
  }, [onPeek, item]);
  const press = useCardPress(open, peek);
  const { agent, bucket } = item;
  const { color } = BUCKET_META[bucket];
  const KindIcon = kindIcon(agent.agent);
  const line = item.line ?? item.terminalTitle;
  const unread = bucket === "ready";
  const flagged = bucket === "needs_you" || bucket === "ready";
  const close = () => swipe.current?.close();
  const label = cardLabel(item, now);

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
      renderLeftActions={(_p, drag) => (
        <>
          <SwipeHaptic drag={drag} at={ACTION_W * 0.8} />
          <SwipeAction label="Read" color={colors.status.idle} Icon={MailOpen} />
        </>
      )}
      renderRightActions={(_p, drag) => (
        <View style={{ flexDirection: "row" }}>
          <SwipeHaptic drag={drag} at={ACTION_W * 0.6} />
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
      <Animated.View style={press.cardStyle}>
        <GestureDetector gesture={press.gesture}>
          <Animated.View
            accessible
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint="Opens the session. Long press to peek."
            accessibilityActions={CARD_ACTIONS}
            onAccessibilityAction={(e) => runCardAction(e.nativeEvent.actionName, item, actions)}
            style={[
              {
                flexDirection: "row",
                gap: space.md,
                padding: space.md,
                paddingLeft: space.md + 3,
                minHeight: hitTarget + space.lg,
                // Room for the "⋯" button on the right.
                paddingRight: hitTarget,
                backgroundColor: colors.card,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.muted,
                overflow: "hidden",
              },
            ]}
          >
            {/* Pressed state: a light layer over the card, not a color swap. */}
            <Animated.View
              pointerEvents="none"
              style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.text }, press.overlayStyle]}
            />
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
                  {item.title}
                </Text>
                <StatusPill item={item} now={now} />
              </View>
              <Text variant="caption" muted numberOfLines={1}>
                {item.subtitle}
              </Text>
              {line ? (
                <Text
                  variant="small"
                  numberOfLines={2}
                  color={bucket === "needs_you" ? colors.status.blocked : bucket === "idle" ? colors.textMuted : colors.text}
                  mono={bucket === "working" && !!item.line}
                >
                  {line}
                </Text>
              ) : null}
            </View>
          </Animated.View>
        </GestureDetector>
        {/* A sibling, not a child, of the card: its touches never reach the card's tap and long press. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More actions"
          onPress={() => actions.onMenu(item)}
          hitSlop={4}
          style={({ pressed }) => ({
            position: "absolute",
            right: 0,
            top: 0,
            width: hitTarget,
            height: hitTarget,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Ellipsis size={20} color={colors.textMuted} />
        </Pressable>
      </Animated.View>
    </ReanimatedSwipeable>
  );
});
