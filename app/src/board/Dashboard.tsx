import { ChevronDown, Plus, Server } from "lucide-react-native";
import { memo, useCallback, useMemo } from "react";
import { FlatList, Image, Pressable, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

import { agentKind } from "@/herdr/names";
import { colors, denseScale, dot, hitTarget, icon, motion, space, state } from "@/theme/tokens";
import { AgentMark } from "@/ui/AgentMark";
import { useElapsed } from "@/ui/StatusIcon";
import { Text } from "@/ui/Text";

import { useCardPress } from "./AgentRow";
import { useBoard } from "./boardStore";
import { BucketStatus } from "./BucketStatus";
import { BUCKET_META } from "./bucketMeta";
import type { BoardItem } from "./buckets";
import { cardActions } from "./cardPress";
import { hostBadges, spotlightLabel, tileWidth, type Spotlight } from "./spotlight";
import { currentPreview, showsTime, statusLine, tileLabel, tileMain, tilePlace, tileTitle, type TileMain } from "./tileText";

/**
 * The Dashboard top of the Board: the brand header, the carousel of large agent tiles, and the
 * "All agents" bar with the group and sort menus. The idea comes from the photo apps that open on
 * a row of large "memories": the agents that want the user are large, and the next tile shows at
 * the right edge, so the user sees that the row scrolls.
 */

/** The tile: height, corner radius, the space between tiles, and the inset of the first tile. */
export const TILE_H = 188;
const TILE_RADIUS = 24;
const TILE_GAP = space.md;
const TILE_INSET = space.lg;
/** The main text of a tile: at most this many lines, then an ellipsis. */
const MAIN_LINES = 3;
/** The agent mark at the left of the tile title. */
const TILE_MARK = 24;
/** The edge of a tile that needs you. */
const EMBER_EDGE = 1.5;
/** The status time shows whole minutes. */
const CHIP_TICK_MS = 30_000;
/** The computers button: circle size and how far each circle overlaps the one before. */
const BADGE = 26;
const BADGE_OVERLAP = space.sm;
/** The brand mark. The image has a transparent margin, so it draws a little larger than its box. */
const MARK = 36;
const TILE_A11Y_ACTIONS = [{ name: "activate" }, { name: "longpress", label: "Peek" }];

/** The Herdling mark and name at the left, the computers button at the right. */
export function BrandHeader({ right }: { right?: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingLeft: space.md,
        paddingRight: space.sm,
        minHeight: hitTarget + space.sm,
        backgroundColor: colors.bg,
      }}
    >
      <Image
        source={require("../../assets/images/splash-icon.png")}
        accessibilityIgnoresInvertColors
        style={{ width: MARK, height: MARK, transform: [{ scale: 1.3 }] }}
      />
      <Text variant="heading" accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flex: 1 }}>
        Herdling
      </Text>
      {right}
    </View>
  );
}

/**
 * The host status in the header: one small circle per host with its first letter and an online
 * dot (sage) or an offline dot (stone), at most 3, then "+n". A tap opens the host list.
 */
export function HostsButton({
  hosts,
  online,
  onPress,
}: {
  hosts: readonly { id: string; name: string }[];
  online: ReadonlySet<string>;
  onPress: () => void;
}) {
  const { badges, more, label } = hostBadges(hosts, online);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the list of computers"
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: hitTarget,
        height: hitTarget,
        paddingHorizontal: space.xs,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      {badges.length === 0 ? <Server size={icon.md} color={colors.text} strokeWidth={icon.strokeWidth} /> : null}
      {badges.map((b, i) => (
        <View
          key={b.id}
          style={{
            width: BADGE,
            height: BADGE,
            borderRadius: BADGE / 2,
            marginLeft: i === 0 ? 0 : -BADGE_OVERLAP,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.raised,
            borderWidth: 2,
            borderColor: colors.bg,
          }}
        >
          <Text variant="caption" bold maxFontSizeMultiplier={1} color={b.online ? colors.text : colors.textMuted}>
            {b.letter}
          </Text>
          <View
            style={{
              position: "absolute",
              right: -2,
              bottom: -2,
              width: dot.size + 2,
              height: dot.size + 2,
              borderRadius: (dot.size + 2) / 2,
              borderWidth: 2,
              borderColor: colors.bg,
              backgroundColor: b.online ? colors.status.done : colors.status.unknown,
            }}
          />
        </View>
      ))}
      {more > 0 ? (
        <Text variant="caption" bold muted maxFontSizeMultiplier={denseScale.pill} style={{ marginLeft: space.xs }}>
          +{more}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The main text of a tile, in the color of its kind. A question takes the attention color. */
function MainText({ main }: { main: TileMain }) {
  const quiet = main.kind === "empty" || main.kind === "background";
  const color = main.kind === "question" ? BUCKET_META.needs_you.color : quiet ? colors.textMuted : colors.text;
  return (
    <Text variant="body" mono={main.kind === "background"} numberOfLines={MAIN_LINES} maxFontSizeMultiplier={denseScale.pill} color={color}>
      {main.text}
    </Text>
  );
}

/**
 * One large agent tile, on `sunken`. The top line: the agent mark, the title, and the status with
 * its time. Under it: the folder (and the computer when more than one is connected). Then the main
 * text: the question, the activity, the last reply or the background command (see `tileMain`).
 * Needs you: an ember edge and the ember tint. Working: a quiet gold edge. Tap opens the session;
 * a long press peeks.
 */
export const SpotlightTile = memo(function SpotlightTile({
  item,
  width,
  focused,
  multiHost,
  onOpen,
  onPeek,
}: {
  item: BoardItem;
  width: number;
  /** True while the Board is focused: the status time ticks. */
  focused: boolean;
  /** True when more than one computer is connected: the folder line also names the computer. */
  multiHost: boolean;
  onOpen: (i: BoardItem) => void;
  onPeek: (i: BoardItem) => void;
}) {
  const { open, peek } = useMemo(() => cardActions(item, onOpen, onPeek), [item, onOpen, onPeek]);
  // A large tile: the hold stays at the first press scale (0.98).
  const press = useCardPress(open, peek, motion.press.scale);
  const entry = useBoard((s) => s.previews[item.key]);
  const main = useMemo(() => tileMain(item.bucket, currentPreview(item, entry)), [item, entry]);
  const elapsed = useElapsed(showsTime(item) ? item.since : undefined, focused, CHIP_TICK_MS);
  const status = statusLine(item.bucket, elapsed);
  const title = tileTitle(item);
  const place = tilePlace(item, multiHost);
  const needsYou = item.bucket === "needs_you";
  const working = item.bucket === "working";
  return (
    <Animated.View
      style={[
        {
          width,
          height: TILE_H,
          borderRadius: TILE_RADIUS,
          overflow: "hidden",
          backgroundColor: colors.sunken,
          borderWidth: needsYou ? EMBER_EDGE : 1,
          borderColor: needsYou ? colors.status.blocked : working ? colors.hintEdge : colors.divider,
        },
        press.cardStyle,
      ]}
    >
      <GestureDetector gesture={press.gesture}>
        <Animated.View
          accessible
          accessibilityRole="button"
          accessibilityLabel={tileLabel(title, status, place, main, item.bucket)}
          accessibilityHint="Opens the session. Long press to peek."
          accessibilityActions={TILE_A11Y_ACTIONS}
          onAccessibilityAction={(e) => (e.nativeEvent.actionName === "longpress" ? onPeek(item) : onOpen(item))}
          style={{ flex: 1 }}
        >
          {needsYou ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.blockedTint }]} /> : null}
          <View style={{ flex: 1, padding: space.lg, gap: space.sm }}>
            <View style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <AgentMark kind={agentKind(item.agent)} size={TILE_MARK} />
                <Text variant="headline" numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flex: 1 }}>
                  {title}
                </Text>
                {/* The status does not truncate: the title gives way to it. */}
                <View style={{ flexShrink: 0 }}>
                  <BucketStatus bucket={item.bucket} label={status} />
                </View>
              </View>
              {place ? (
                <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ paddingLeft: TILE_MARK + space.sm }}>
                  {place}
                </Text>
              ) : null}
            </View>
            {/* The tile clips the main text at large text sizes; three lines fit at the default size. */}
            <View style={{ flex: 1, overflow: "hidden" }}>
              <MainText main={main} />
            </View>
          </View>
          {/* Pressed state: a light layer over the tile, not a color swap. */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.text }, press.overlayStyle]}
          />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
});

/** The last tile: a dashed edge and a gold "+". It does what the floating "+" button does. */
function NewSessionTile({ width, onPress }: { width: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New session"
      onPress={onPress}
      style={({ pressed }) => ({
        width,
        height: TILE_H,
        borderRadius: TILE_RADIUS,
        borderWidth: EMBER_EDGE,
        borderStyle: "dashed",
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        gap: space.sm,
        backgroundColor: pressed ? colors.raised : undefined,
      })}
    >
      <Plus size={icon.lg + space.sm} color={colors.accent} strokeWidth={icon.strokeWidth} />
      <Text variant="headline" maxFontSizeMultiplier={denseScale.row}>
        New session
      </Text>
    </Pressable>
  );
}

type Slot = { kind: "agent"; item: BoardItem } | { kind: "new" };
const NEW_KEY = "new";

/**
 * The carousel: a section label ("Highlights" or "Recent"), then the tiles in one row that snaps
 * tile by tile. No auto scroll.
 */
export function SpotlightCarousel({
  spot,
  room,
  focused,
  multiHost = false,
  onOpen,
  onPeek,
  onNew,
}: {
  spot: Spotlight;
  /** The width the Board has, in points. */
  room: number;
  focused: boolean;
  /** True when more than one computer is connected. */
  multiHost?: boolean;
  onOpen: (i: BoardItem) => void;
  onPeek: (i: BoardItem) => void;
  onNew: () => void;
}) {
  const width = tileWidth(room);
  const data = useMemo<Slot[]>(() => [...spot.items.map((item): Slot => ({ kind: "agent", item })), { kind: "new" }], [spot.items]);
  const renderItem = useCallback(
    ({ item: s }: { item: Slot }) =>
      s.kind === "agent" ? (
        <SpotlightTile item={s.item} width={width} focused={focused} multiHost={multiHost} onOpen={onOpen} onPeek={onPeek} />
      ) : (
        <NewSessionTile width={width} onPress={onNew} />
      ),
    [width, focused, multiHost, onOpen, onPeek, onNew],
  );
  return (
    <View style={{ gap: space.sm, paddingTop: space.xs, paddingBottom: space.md }}>
      <Text variant="section" accessibilityRole="header" maxFontSizeMultiplier={denseScale.row} style={{ paddingHorizontal: space.lg }}>
        {spotlightLabel(spot.kind)}
      </Text>
      <FlatList
        horizontal
        data={data}
        keyExtractor={(s) => (s.kind === "agent" ? s.item.key : NEW_KEY)}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        snapToInterval={width + TILE_GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: TILE_INSET }}
        ItemSeparatorComponent={TileGap}
      />
    </View>
  );
}

function TileGap() {
  return <View style={{ width: TILE_GAP }} />;
}

/** A compact menu button in the "All agents" bar: "Group: Status ▾". */
function MenuButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={`Changes the ${label.toLowerCase()} of the agent list`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingHorizontal: space.xs,
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      <Text variant="small" muted maxFontSizeMultiplier={denseScale.row}>
        {label}:{" "}
      </Text>
      <Text variant="small" bold maxFontSizeMultiplier={denseScale.row}>
        {value}
      </Text>
      <ChevronDown size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}

/** The bar above the agent list: "All agents" and the count, then the group and sort menus. */
export function AllAgentsBar({
  count,
  group,
  sort,
  onGroup,
  onSort,
}: {
  count: number;
  group: string;
  sort: string;
  onGroup: () => void;
  onSort: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: space.sm,
        paddingLeft: space.lg,
        paddingRight: space.sm,
        paddingTop: space.sm,
      }}
    >
      <View accessible accessibilityRole="header" style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm, flexGrow: 1 }}>
        <Text variant="title" maxFontSizeMultiplier={denseScale.row}>
          All agents
        </Text>
        <Text variant="small" muted maxFontSizeMultiplier={denseScale.row} style={{ fontVariant: ["tabular-nums"] }}>
          {count}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <MenuButton label="Group" value={group} onPress={onGroup} />
        <MenuButton label="Sort" value={sort} onPress={onSort} />
      </View>
    </View>
  );
}
