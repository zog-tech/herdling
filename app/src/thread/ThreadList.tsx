import type { ThreadItem } from "@zogssh/protocol";
import { ArrowDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FlatList, Pressable, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { colors, hitTarget, radius, space, state } from "@/theme/tokens";
import { Text } from "@/ui/Text";
import { DelayedSpinner } from "@/ui/Delayed";
import { LiveToolContext, newestRunningTool, ThreadPaneContext } from "./LiveToolContext";
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
  /** The pane the thread belongs to, for live tool output. `active`: the screen is focused. */
  live?: { hostId: string; paneId: string; active: boolean };
};

const keyExtractor = (item: ThreadItem) => item.id;
const renderItem = ({ item }: { item: ThreadItem }) => <ThreadRow item={item} />;
const Gap = () => <View style={{ height: space.md }} />;

/**
 * Inverted list, newest at the bottom. Stays pinned to the bottom only while the user is there;
 * otherwise new items keep the view still and a "New messages" pill appears.
 */
export function ThreadList({ items, loadOlder, loadingOlder, hasOlder, tail, live }: Props) {
  const list = useRef<FlatList<ThreadItem>>(null);
  const data = useMemo(() => items.slice().reverse(), [items]);
  const atBottom = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const newestId = items.length > 0 ? items[items.length - 1].id : undefined;
  const lastNewest = useRef(newestId);

  useEffect(() => {
    const prev = lastNewest.current;
    lastNewest.current = newestId;
    if (prev !== undefined && newestId !== prev && !atBottom.current) setUnseen(true);
  }, [newestId]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const bottom = e.nativeEvent.contentOffset.y <= BOTTOM_SLOP;
    atBottom.current = bottom;
    if (bottom) setUnseen(false);
  }, []);

  const newestRunningId = useMemo(() => newestRunningTool(items), [items]);
  const liveValue = useMemo(
    () => (live ? { hostId: live.hostId, paneId: live.paneId, active: live.active, newestRunningId } : null),
    [live?.hostId, live?.paneId, live?.active, newestRunningId],
  );

  const pane = useMemo(() => (live ? { hostId: live.hostId, paneId: live.paneId } : null), [live?.hostId, live?.paneId]);

  const toBottom = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: true });
    setUnseen(false);
  }, []);

  return (
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
            scrollEventThrottle={64}
            onEndReached={hasOlder ? loadOlder : undefined}
            onEndReachedThreshold={0.6}
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: BOTTOM_SLOP }}
            // Inverted: the header sits after the newest item.
            ListHeaderComponent={tail ?? undefined}
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
                backgroundColor: colors.accent,
                opacity: pressed ? state.pressedFill : 1,
              })}
              hitSlop={4}
            >
              <ArrowDown size={16} color={colors.onAccent} />
              <Text variant="small" bold color={colors.onAccent}>
                New messages
              </Text>
            </Pressable>
          ) : null}
        </View>
      </LiveToolContext.Provider>
    </ThreadPaneContext.Provider>
  );
}
