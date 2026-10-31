import type { ThreadItem } from "@herdling/protocol";
import { ArrowDown } from "lucide-react-native";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { FlatList, Pressable, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

import { colors, hitTarget, motion, radius, space } from "@/theme/tokens";
import { STATUS_ANIM_MS } from "@/ui/StatusRow";
import { Text } from "@/ui/Text";
import { DelayedSpinner } from "@/ui/Delayed";
import { Arrivals, ArrivalsContext } from "./arrivals";
import { LiveToolContext, newestRunningTool, ThreadPaneContext } from "./LiveToolContext";
import { SearchMark } from "./searchMarks";
import { ThreadRow } from "./ThreadRow";

/** Within this many points of the newest item counts as "at the bottom". */
const BOTTOM_SLOP = 48;

type Props = {
  items: ThreadItem[];
  loadOlder: () => void;
  loadingOlder: boolean;
  hasOlder: boolean;
  /** Shown after the newest item (the pending prompts). */
  tail?: ReactElement | null;
  /** Shown after the tail: the agent status pill. `footerShown`: it takes room now, so keep it in view. */
  footer?: ReactElement | null;
  footerShown?: boolean;
  /** The pane the thread belongs to, for live tool output. `active`: the screen is focused. */
  live?: { hostId: string; paneId: string; active: boolean };
  /** Search: scroll this item into the middle of the view when it changes. */
  focusId?: string;
};

// The list is inverted (each cell is flipped), so a negative offset starts the row below its place.
const ARRIVE = {
  from: { opacity: 0, transform: [{ translateY: -motion.arrive.rise }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const ARRIVE_FADE = { from: { opacity: 0 }, to: { opacity: 1 } };
const ARRIVE_EASE = cubicBezier(...motion.ease.out);

/**
 * A row that arrived while the user was at the bottom fades in and rises 6 pt (CSS animation, UI
 * thread). Reduce Motion: a fade only. Rows of a loaded page show at once.
 */
function Arrive({ id, index, children }: { id: string; index: number; children: ReactNode }) {
  const arrivals = useContext(ArrivalsContext);
  const reduced = useReducedMotion();
  const [animate] = useState(() => arrivals?.claim(id, index) ?? false);
  if (!animate) return <>{children}</>;
  return (
    <Animated.View
      style={{
        animationName: reduced ? ARRIVE_FADE : ARRIVE,
        animationDuration: motion.arrive.durationMs,
        animationTimingFunction: ARRIVE_EASE,
      }}
    >
      {children}
    </Animated.View>
  );
}

const keyExtractor = (item: ThreadItem) => item.id;
const renderItem = ({ item, index }: { item: ThreadItem; index: number }) => (
  <Arrive id={item.id} index={index}>
    <SearchMark id={item.id}>
      <ThreadRow item={item} />
    </SearchMark>
  </Arrive>
);
const Gap = () => <View style={{ height: space.md }} />;

/**
 * Inverted list, newest at the bottom. Stays pinned to the bottom only while the user is there;
 * otherwise new items keep the view still and a "New messages" pill appears.
 */
export function ThreadList({ items, loadOlder, loadingOlder, hasOlder, tail, footer, footerShown, live, focusId }: Props) {
  const list = useRef<FlatList<ThreadItem>>(null);
  const data = useMemo(() => items.slice().reverse(), [items]);
  const atBottom = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const newestId = items.length > 0 ? items[items.length - 1].id : undefined;
  const lastNewest = useRef(newestId);
  const [arrivals] = useState(() => new Arrivals());

  // After each commit: these items are known, so a later mount of their row does not animate.
  useEffect(() => {
    arrivals.commit(items.map((i) => i.id));
  }, [items, arrivals]);

  useEffect(() => {
    const prev = lastNewest.current;
    lastNewest.current = newestId;
    if (prev !== undefined && newestId !== prev && !atBottom.current) setUnseen(true);
  }, [newestId]);

  // The pill grows the header. When it shows while the user is at the bottom, keep offset 0 until it is
  // fully open, so the newest message and the pill are both in view. A drag cancels this.
  const pinned = useRef(false);
  useEffect(() => {
    if (!footerShown || !atBottom.current) return;
    pinned.current = true;
    list.current?.scrollToOffset({ offset: 0, animated: false });
    const id = setTimeout(() => {
      pinned.current = false;
    }, STATUS_ANIM_MS + 120);
    return () => clearTimeout(id);
  }, [footerShown]);
  const onContentSizeChange = useCallback(() => {
    if (pinned.current) list.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  const onScrollBeginDrag = useCallback(() => {
    pinned.current = false;
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const bottom = e.nativeEvent.contentOffset.y <= BOTTOM_SLOP;
    atBottom.current = bottom;
    arrivals.atBottom = bottom;
    if (bottom) setUnseen(false);
  }, [arrivals]);

  const newestRunningId = useMemo(() => newestRunningTool(items), [items]);
  const liveValue = useMemo(
    () => (live ? { hostId: live.hostId, paneId: live.paneId, active: live.active, newestRunningId } : null),
    [live?.hostId, live?.paneId, live?.active, newestRunningId],
  );

  const pane = useMemo(() => (live ? { hostId: live.hostId, paneId: live.paneId } : null), [live?.hostId, live?.paneId]);

  // Search jumps. A row far from the rendered window has no layout yet: scroll near it, then try again.
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!focusId) return;
    const index = dataRef.current.findIndex((i) => i.id === focusId);
    if (index < 0) return;
    pinned.current = false;
    list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, [focusId]);
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => {
      if (info.index < dataRef.current.length) list.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true });
    }, 120);
  }, []);

  const toBottom = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: true });
    setUnseen(false);
  }, []);

  return (
    <ArrivalsContext.Provider value={arrivals}>
    <ThreadPaneContext.Provider value={pane}>
      <LiveToolContext.Provider value={liveValue}>
        <View style={{ flex: 1 }}>
          <FlatList
            ref={list}
            inverted
            data={data}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            ItemSeparatorComponent={Gap}
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
            onScroll={onScroll}
            onContentSizeChange={onContentSizeChange}
            onScrollBeginDrag={onScrollBeginDrag}
            onScrollToIndexFailed={onScrollToIndexFailed}
            scrollEventThrottle={64}
            onEndReached={hasOlder ? loadOlder : undefined}
            onEndReachedThreshold={0.6}
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: BOTTOM_SLOP }}
            // Inverted: the header sits after the newest item.
            ListHeaderComponent={
              tail || footer ? (
                <>
                  {tail}
                  {footer}
                </>
              ) : undefined
            }
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            initialNumToRender={12}
            windowSize={11}
            ListFooterComponent={
              loadingOlder ? (
                <View style={{ padding: space.md, alignItems: "center" }}>
                  <DelayedSpinner color={colors.textMuted} />
                </View>
              ) : !hasOlder && items.length > 0 ? (
                <Text variant="caption" muted style={{ textAlign: "center", padding: space.md }}>
                  Start of conversation
                </Text>
              ) : undefined
            }
          />
          {unseen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scroll to new messages"
              onPress={toBottom}
              style={({ pressed }) => ({
                position: "absolute",
                bottom: space.md,
                alignSelf: "center",
                minHeight: hitTarget - 8,
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs,
                paddingHorizontal: space.lg,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? colors.card : colors.raised,
              })}
              hitSlop={4}
            >
              <ArrowDown size={16} color={colors.text} />
              <Text variant="small" bold>
                New messages
              </Text>
            </Pressable>
          ) : null}
        </View>
      </LiveToolContext.Provider>
    </ThreadPaneContext.Provider>
    </ArrivalsContext.Provider>
  );
}
