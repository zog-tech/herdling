import { ChevronRight, Ellipsis, MailOpen, Reply, RotateCcw } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
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

import { colors, denseScale, hitTarget, icon, motion, radius, space, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { useElapsed } from "@/ui/StatusIcon";
import { Text } from "@/ui/Text";
import { TopHighlight } from "@/ui/TopHighlight";

import type { RowStyle } from "./boardPrefs";
import type { BoardItem } from "./buckets";
import { BUCKET_META } from "./bucketMeta";
import { BucketStatus } from "./BucketStatus";
import { CARD_ACTIONS, cardLabel, runCardAction } from "./a11y";
import { claimEnterDelay } from "./boardEnter";
import { cardActions, makeCardPress } from "./cardPress";
import { footerMeta, placeholderLine } from "./rowText";

const ACTION_W = 84;
/** Row title: room it keeps beside the status, and its Dynamic Type cap (a dense row). */
const TITLE_MIN = 140;
const TITLE_SCALE = 2;
/** A finger that moves further than this is a swipe or a scroll, not a press. */
const PRESS_SLOP = 10;
/** Width of the ember glow at the left edge, and its peak opacity. */
const EMBER_W = 56;
const EMBER_PEAK = 0.45;
/** Width of the ember marker at the left edge of a row that needs you. */
const MARKER_W = 3;
const EASE_OUT = Easing.bezier(...motion.ease.out);
const EASE_IN_OUT = Easing.bezier(...motion.ease.inOut);
/** Card style: corner radius, and the space to the screen edges. */
const CARD_RADIUS = radius.lg + 2;
const CARD_MARGIN = space.md;
/** The card footer time shows whole minutes, so a slow clock is enough. */
const META_TICK_MS = 30_000;
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

/**
 * Hides the swipe panels while the card is at rest. The long-press scale shrinks the card inside
 * the swipeable, and without this the colored panels show at its edges.
 */
function SwipePanels({ drag, children }: { drag: SharedValue<number>; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => ({ opacity: Math.abs(drag.get()) > 0.5 ? 1 : 0 }));
  return <Animated.View style={[{ flexDirection: "row" }, style]}>{children}</Animated.View>;
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
export function useCardPress(onTap: () => void, onLong: () => void, holdScale: number) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const overlay = useSharedValue(0);
  // The worklets call stable functions that read the newest handlers, so a Board refresh does not
  // replace the gesture callbacks while a finger is down.
  const handlers = useRef({ onTap, onLong });
  handlers.current = { onTap, onLong };
  const tapNow = useCallback(() => handlers.current.onTap(), []);
  const longNow = useCallback(() => handlers.current.onLong(), []);
  const p = useMemo(
    () => makeCardPress({ scale, overlay }, reduced, tapNow, longNow, holdScale),
    [scale, overlay, reduced, tapNow, longNow, holdScale],
  );
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

/** The box of a card: one step above the page, with a quiet edge. It clips the marker and the tint. */
const cardBox = () =>
  ({
    backgroundColor: colors.card,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: "hidden",
  }) as const;

/**
 * The footer of a card, under a hairline from edge to edge: the time at the left (when known), a
 * gold "Open" and a chevron at the right. With large text the "Open" moves under the time.
 */
function CardFooter({ meta }: { meta: string | undefined }) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: space.md,
        rowGap: space.xs,
        marginTop: space.sm + 2,
        marginHorizontal: -space.lg,
        paddingHorizontal: space.lg,
        paddingTop: space.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.divider,
      }}
    >
      {meta ? (
        <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flexShrink: 1 }}>
          {meta}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginLeft: "auto" }}>
        <Text variant="small" bold color={colors.accent} maxFontSizeMultiplier={denseScale.row}>
          Open
        </Text>
        <ChevronRight size={icon.sm} color={colors.accent} strokeWidth={icon.strokeWidth} />
      </View>
    </View>
  );
}

/**
 * One agent on the Board. Title, then "host · agent", then the latest line. Status is a dot and a
 * word. A row that needs you has an ember marker and a faint ember tint.
 * `rowStyle` (Settings, "Agent list style"):
 * - `flat`: a row with no box and a "⋯" button.
 * - `divided`: a row with a chevron at the right edge. The Board puts a divider between rows.
 * - `cards`: a card with a footer: the time at the left, a gold "Open" at the right.
 * `divided` and `cards` have no "⋯" button: its actions stay in the peek, the swipes and VoiceOver.
 * Tap opens the session, long-press peeks. Swipe right marks it read; swipe left reveals Reply and
 * Restart. VoiceOver gets the same actions as custom actions.
 */
export const AgentRow = memo(function AgentRow({
  item,
  selected = false,
  rowStyle = "flat",
  ...actions
}: {
  item: BoardItem;
  /** The row's session shows in the detail column (two-column layout only). */
  selected?: boolean;
  rowStyle?: RowStyle;
} & CardActions) {
  const swipe = useRef<SwipeableMethods>(null);
  const [hovered, setHovered] = useState(false);
  const { onOpen, onPeek } = actions;
  const { open, peek } = useMemo(() => cardActions(item, onOpen, onPeek), [item, onOpen, onPeek]);
  const cards = rowStyle === "cards";
  const divided = rowStyle === "divided";
  // A card is wide: the hold stays at the first press scale, so the card does not shrink much.
  const press = useCardPress(open, peek, cards ? motion.press.scale : motion.press.holdScale);
  const enterStyle = useEnter();
  const needsYou = item.bucket === "needs_you";
  const emberStyle = useEmberPulse(needsYou);
  const { bucket } = item;
  const { color } = BUCKET_META[bucket];
  const line = item.line ?? item.terminalTitle;
  const placeholder = placeholderLine(item, rowStyle);
  const elapsed = useElapsed(item.since, cards, META_TICK_MS);
  const meta = cards ? footerMeta(bucket, elapsed, item.sinceKnown === true) : undefined;
  const close = () => swipe.current?.close();
  const label = cardLabel(item);

  return (
    <Animated.View style={[enterStyle, cards ? { marginHorizontal: CARD_MARGIN } : null]}>
      <ReanimatedSwipeable
        ref={swipe}
        friction={1.5}
        leftThreshold={ACTION_W * 0.8}
        rightThreshold={ACTION_W * 0.6}
        overshootLeft={false}
        overshootRight={false}
        // A card clips the swipe to its corners. At rest the panels are hidden (SwipePanels).
        containerStyle={cards ? { backgroundColor: colors.bg, borderRadius: CARD_RADIUS, overflow: "hidden" } : { backgroundColor: colors.bg }}
        onSwipeableOpen={(dir) => {
          // Swiping right opens the left panel: that is "mark read", done on release.
          if (dir === SwipeDirection.RIGHT) {
            actions.onMarkRead(item);
            close();
          }
        }}
        renderLeftActions={(_p, drag) => (
          <SwipePanels drag={drag}>
            <SwipeHaptic drag={drag} at={ACTION_W * 0.8} />
            <SwipeAction label="Read" color={colors.status.done} Icon={MailOpen} />
          </SwipePanels>
        )}
        renderRightActions={(_p, drag) => (
          <SwipePanels drag={drag}>
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
          </SwipePanels>
        )}
      >
        <Animated.View style={[cards ? cardBox() : { backgroundColor: colors.bg }, press.cardStyle]}>
          {cards ? <TopHighlight inset={CARD_RADIUS} /> : null}
          <GestureDetector gesture={press.gesture}>
            <Animated.View
              accessible
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityHint="Opens the session. Long press to peek."
              accessibilityState={selected ? { selected: true } : undefined}
              accessibilityActions={CARD_ACTIONS}
              onAccessibilityAction={(e) => runCardAction(e.nativeEvent.actionName, item, actions)}
              onPointerEnter={() => setHovered(true)}
              onPointerLeave={() => setHovered(false)}
              style={{
                gap: 3,
                paddingTop: space.md + 2,
                paddingBottom: cards ? space.md : space.md + 2,
                paddingLeft: space.lg,
                // Room for the "⋯" button or the chevron on the right.
                paddingRight: cards ? space.lg : divided ? icon.md + space.md + space.sm : hitTarget + space.xs,
                minHeight: hitTarget + space.lg,
                backgroundColor: needsYou ? colors.blockedTint : undefined,
                overflow: "hidden",
              }}
            >
              {/* Pressed state: a light layer over the row, not a color swap. */}
              <Animated.View
                pointerEvents="none"
                style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.text }, press.overlayStyle]}
              />
              {/* Selected (two columns) or under the pointer: a light layer, under the content. */}
              {selected || hovered ? (
                <View
                  pointerEvents="none"
                  style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: selected ? state.selectedFill : state.hoverFill }}
                />
              ) : null}
              {selected && !needsYou ? (
                <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: MARKER_W, backgroundColor: colors.accent }} />
              ) : null}
              {/* The ember marker: the one loud edge on the Board. The status word still says "Needs you". */}
              {needsYou ? (
                <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: MARKER_W, backgroundColor: color }} />
              ) : null}
              {/* The ember glow: one pulse from the left edge when the row starts to need you. */}
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
              {/* Wraps: with large text the status moves under the title instead of squeezing it. */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.md, rowGap: space.xs }}>
                {/* Two lines before the title truncates (Dynamic Type makes long names wrap). */}
                <Text
                  variant="headline"
                  numberOfLines={2}
                  maxFontSizeMultiplier={TITLE_SCALE}
                  style={{ flexGrow: 1, flexShrink: 1, flexBasis: TITLE_MIN }}
                >
                  {item.title}
                </Text>
                <BucketStatus bucket={bucket} />
              </View>
              <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
                {item.subtitle}
              </Text>
              {line ? (
                <Text
                  variant="small"
                  numberOfLines={2}
                  maxFontSizeMultiplier={TITLE_SCALE}
                  color={needsYou ? colors.text : colors.textMuted}
                  mono={bucket === "working" && !!item.line}
                  style={{ marginTop: 3 }}
                >
                  {line}
                </Text>
              ) : placeholder ? (
                <Text variant="small" muted numberOfLines={1} maxFontSizeMultiplier={TITLE_SCALE} style={{ marginTop: 3 }}>
                  {placeholder}
                </Text>
              ) : null}
              {cards ? <CardFooter meta={meta} /> : null}
              {/* Decorative: the row is already a button for VoiceOver. */}
              {divided ? (
                <View
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{ position: "absolute", right: space.md, top: 0, bottom: 0, justifyContent: "center" }}
                >
                  <ChevronRight size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
                </View>
              ) : null}
            </Animated.View>
          </GestureDetector>
          {/* A sibling, not a child, of the row: its touches never reach the row's tap and long press. */}
          {rowStyle === "flat" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`More actions for ${item.title}`}
              onPress={() => actions.onMenu(item)}
              hitSlop={4}
              style={({ pressed }) => ({
                position: "absolute",
                right: space.xs,
                top: space.xs,
                width: hitTarget,
                height: hitTarget,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? state.pressedOpacity : 1,
              })}
            >
              <Ellipsis size={icon.md} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </Animated.View>
      </ReanimatedSwipeable>
    </Animated.View>
  );
});
