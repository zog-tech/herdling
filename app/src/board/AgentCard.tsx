import { Ellipsis, MailOpen, Reply, RotateCcw } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector, useExclusiveGestures, useLongPressGesture, useTapGesture } from "react-native-gesture-handler";
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { colors, denseScale, hitTarget, motion, radius, space, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { TopHighlight } from "@/ui/TopHighlight";

import type { BoardItem } from "./buckets";
import { BUCKET_META, kindIcon } from "./bucketMeta";
import { CARD_ACTIONS, cardLabel, runCardAction } from "./a11y";
import { claimEnterDelay } from "./boardEnter";
import { cardActions, makeCardPress } from "./cardPress";
import { StatusPill } from "./StatusPill";

const ACTION_W = 84;
/** Card title: room it keeps beside the pill, and its Dynamic Type cap (a dense row). */
const TITLE_MIN = 140;
const TITLE_SCALE = 2;
/** A finger that moves further than this is a swipe or a scroll, not a press. */
const PRESS_SLOP = 10;
/** Width of the ember glow at the left edge, and its peak opacity. */
const EMBER_W = 56;
const EMBER_PEAK = 0.45;
const EASE_OUT = Easing.bezier(...motion.ease.out);
const EASE_IN_OUT = Easing.bezier(...motion.ease.inOut);
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
        opacity: pressed ? state.pressedFill : 1,
      })}
    >
      <Icon size={20} color={colors.onAccent} />
      <Text variant="caption" bold color={colors.onAccent}>
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
 * Board enter: the first cards of the first load per app launch fade in and rise, one after the
 * other. Reduce Motion: opacity only. Cards that mount later show at once.
 */
function useEnter() {
  const reduced = useReducedMotion();
  const [delay] = useState(() => claimEnterDelay());
  const progress = useSharedValue(delay === undefined ? 1 : 0);
  useEffect(() => {
    if (delay === undefined) return;
    progress.set(withDelay(delay, withTiming(1, { duration: motion.boardEnter.durationMs, easing: EASE_OUT })));
  }, [delay, progress]);
  return useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: reduced ? 0 : (1 - progress.get()) * motion.boardEnter.rise }],
  }));
}

/** "Needs you": the ember edge glows once when the card moves into the bucket. No loop. */
function useEmberPulse(needsYou: boolean) {
  const glow = useSharedValue(0);
  const prev = useRef(needsYou);
  useEffect(() => {
    const was = prev.current;
    prev.current = needsYou;
    if (!needsYou || was) return;
    const half = motion.emberPulseMs / 2;
    glow.set(
      withSequence(
        withTiming(EMBER_PEAK, { duration: half, easing: EASE_OUT }),
        withTiming(0, { duration: half, easing: EASE_IN_OUT }),
      ),
    );
  }, [needsYou, glow]);
  return useAnimatedStyle(() => ({ opacity: glow.get() }));
}

/**
 * One agent on the Board. Tap opens the session, long-press peeks. Swipe right marks it read;
 * swipe left reveals Reply and Restart. VoiceOver gets the same actions as custom actions.
 */
export const AgentCard = memo(function AgentCard({ item, now, ...actions }: { item: BoardItem; now: number } & CardActions) {
  const swipe = useRef<SwipeableMethods>(null);
  const { onOpen, onPeek } = actions;
  const { open, peek } = useMemo(() => cardActions(item, onOpen, onPeek), [item, onOpen, onPeek]);
  const press = useCardPress(open, peek);
  const enterStyle = useEnter();
  const emberStyle = useEmberPulse(item.bucket === "needs_you");
  const { agent, bucket } = item;
  const { color } = BUCKET_META[bucket];
  const KindIcon = kindIcon(agent.agent);
  const line = item.line ?? item.terminalTitle;
  const unread = bucket === "ready";
  const flagged = bucket === "needs_you" || bucket === "ready";
  const close = () => swipe.current?.close();
  const label = cardLabel(item, now);

  return (
    <Animated.View style={enterStyle}>
    <ReanimatedSwipeable
      ref={swipe}
      friction={1.5}
      leftThreshold={ACTION_W * 0.8}
      rightThreshold={ACTION_W * 0.6}
      overshootLeft={false}
      overshootRight={false}
      containerStyle={{ borderRadius: radius.lg, backgroundColor: colors.raised }}
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
          <SwipeAction label="Read" color={colors.status.done} Icon={MailOpen} />
        </>
      )}
      renderRightActions={(_p, drag) => (
        <View style={{ flexDirection: "row" }}>
          <SwipeHaptic drag={drag} at={ACTION_W * 0.6} />
          <SwipeAction
            label="Reply"
            color={colors.accent}
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
                borderColor: colors.edge,
                overflow: "hidden",
              },
            ]}
          >
            <TopHighlight inset={radius.lg} />
            {/* Pressed state: a light layer over the card, not a color swap. */}
            <Animated.View
              pointerEvents="none"
              style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.text }, press.overlayStyle]}
            />
            {/* Accent edge for cards that want attention; the pill still carries icon + label. */}
            {flagged ? (
              <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: color }} />
            ) : null}
            {/* The ember glow: one pulse from the left edge when the card starts to need you. */}
            <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, bottom: 0, width: EMBER_W }, emberStyle]}>
              <Svg width={EMBER_W} height="100%">
                <Defs>
                  <LinearGradient id="ember" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor={colors.status.blocked} stopOpacity={1} />
                    <Stop offset="1" stopColor={colors.status.blocked} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width={EMBER_W} height="100%" fill="url(#ember)" />
              </Svg>
            </Animated.View>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: radius.md,
                backgroundColor: colors.raised,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <KindIcon size={18} color={colors.text} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              {/* Wraps: with large text the pill moves under the title instead of squeezing it. */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", columnGap: space.sm, rowGap: space.xs }}>
                {unread ? (
                  <View
                    accessibilityElementsHidden
                    style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.status.done }}
                  />
                ) : null}
                {/* Two lines before the title truncates (Dynamic Type makes long names wrap). */}
                <Text bold numberOfLines={2} maxFontSizeMultiplier={TITLE_SCALE} style={{ flexGrow: 1, flexShrink: 1, flexBasis: TITLE_MIN }}>
                  {item.title}
                </Text>
                <StatusPill item={item} now={now} />
              </View>
              <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
                {item.subtitle}
              </Text>
              {line ? (
                <Text
                  variant="small"
                  numberOfLines={2}
                  maxFontSizeMultiplier={TITLE_SCALE}
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
          accessibilityLabel={`More actions for ${item.title}`}
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
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <Ellipsis size={20} color={colors.textMuted} />
        </Pressable>
      </Animated.View>
    </ReanimatedSwipeable>
    </Animated.View>
  );
});
