import type { ThreadItem } from "@zogssh/protocol";
import { ArrowDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { colors, hitTarget, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";
import { ThreadRow } from "./ThreadRow";

/** Within this many points of the newest item counts as "at the bottom". */
const BOTTOM_SLOP = 48;

type Props = {
  items: ThreadItem[];
  loadOlder: () => void;
  loadingOlder: boolean;
  hasOlder: boolean;
};

const keyExtractor = (item: ThreadItem) => item.id;
const renderItem = ({ item }: { item: ThreadItem }) => <ThreadRow item={item} />;
const Gap = () => <View style={{ height: space.md }} />;

/**
 * Inverted list, newest at the bottom. Stays pinned to the bottom only while the user is there;
 * otherwise new items keep the view still and a "New messages" pill appears.
 */
export function ThreadList({ items, loadOlder, loadingOlder, hasOlder }: Props) {
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

  const toBottom = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: true });
    setUnseen(false);
  }, []);

  return (
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
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={11}
        ListFooterComponent={
          loadingOlder ? (
            <ActivityIndicator color={colors.textMuted} style={{ padding: space.md }} />
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
            opacity: pressed ? 0.85 : 1,
          })}
          hitSlop={4}
        >
          <ArrowDown size={16} color={colors.bg} />
          <Text variant="small" bold color={colors.bg}>
            New messages
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
