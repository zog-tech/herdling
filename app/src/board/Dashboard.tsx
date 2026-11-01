import { ChevronDown, Plus, Server } from "lucide-react-native";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Image, Pressable, StyleSheet, View, type ListViewToken } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { useTerminalText } from "@/thread/useTerminalText";
import { colors, denseScale, dot, hitTarget, icon, motion, radius, space, state } from "@/theme/tokens";
import { useElapsed } from "@/ui/StatusIcon";
import { Text } from "@/ui/Text";

import { useCardPress } from "./AgentRow";
import { cardLabel } from "./a11y";
import { BucketStatus } from "./BucketStatus";
import type { BoardItem } from "./buckets";
import { cardActions } from "./cardPress";
import { shortElapsed } from "./rowText";
import { hostBadges, lastLines, spotlightLabel, tileWidth, type Spotlight } from "./spotlight";

/**
 * The Dashboard top of the Board: the brand header, the carousel of large agent tiles, and the
 * "All agents" bar with the group and sort menus. The idea comes from the photo apps that open on
 * a row of large "memories": the agents that want the user are large, and the next tile shows at
 * the right edge, so the user sees that the row scrolls.
 */

/** The tile: height, corner radius, the space between tiles, and the inset of the first tile. */
export const TILE_H = 210;
const TILE_RADIUS = 24;
const TILE_GAP = space.md;
const TILE_INSET = space.lg;
/** The terminal snapshot: lines it shows, lines it reads (blank lines at the end are dropped). */
const SNAP_LINES = 10;
const SNAP_READ = 40;
/** A slow read: the tile is a glance, not the live terminal. `pane.watch` reads at this interval. */
const SNAP_MS = 5_000;
/** Snapshot text: line height, and the room it keeps at the bottom for the title, status and subtitle. */
const SNAP_LH = 16;
const SNAP_BOTTOM = Math.round(TILE_H * 0.38);
/** The fade to the tile fill: it starts and ends at these shares of the tile height. */
const FADE_FROM = 0.5;
const FADE_TO = 0.75;
/** The edge of a tile that needs you. */
const EMBER_EDGE = 1.5;
/** The elapsed chip shows whole minutes. */
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

/** The last lines of the agent's screen, small and dim. Without a screen: the latest line, larger. */
function Snapshot({ item, read }: { item: BoardItem; read: boolean }) {
  const { text } = useTerminalText(item.hostId, item.agent.pane_id, read, { lines: SNAP_READ, refreshMs: SNAP_MS });
  const lines = useMemo(() => lastLines(text, SNAP_LINES), [text]);
  const fallback = item.line ?? item.terminalTitle;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // The newest line sits just above the title. Older lines go up and the tile clips them.
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        paddingHorizontal: space.md,
        paddingBottom: SNAP_BOTTOM,
        justifyContent: "flex-end",
      }}
    >
      {lines.length > 0 ? (
        lines.map((l, i) => (
          <Text key={i} variant="caption" mono numberOfLines={1} maxFontSizeMultiplier={1} color={colors.textMuted} style={{ lineHeight: SNAP_LH }}>
            {l || " "}
          </Text>
        ))
      ) : fallback ? (
        <Text variant="title" numberOfLines={3} maxFontSizeMultiplier={1.2} color={colors.textMuted}>
          {fallback}
        </Text>
      ) : null}
    </View>
  );
}

/** How long a working agent works, or how long an agent waits for you: "4 min". */
function ElapsedChip({ since }: { since: number }) {
  const elapsed = useElapsed(since, true, CHIP_TICK_MS);
  if (elapsed === undefined) return null;
  return (
    <View
      style={{
        position: "absolute",
        top: space.md,
        right: space.md,
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: colors.glassFallback,
      }}
    >
      <Text variant="caption" bold maxFontSizeMultiplier={denseScale.pill} style={{ fontVariant: ["tabular-nums"] }}>
        {shortElapsed(elapsed)}
      </Text>
    </View>
  );
}

/**
 * One large agent tile: the terminal snapshot on `sunken`, a fade to the tile fill, and the title,
 * status and "host · agent" at the bottom. Needs you: an ember edge and the ember tint. Working: a
 * quiet gold edge. Tap opens the session; a long press peeks.
 */
export const SpotlightTile = memo(function SpotlightTile({
  item,
  width,
  read,
  onOpen,
  onPeek,
}: {
  item: BoardItem;
  width: number;
  /** True while the tile is on screen and the Board is focused: the snapshot reads the screen. */
  read: boolean;
  onOpen: (i: BoardItem) => void;
  onPeek: (i: BoardItem) => void;
}) {
  const { open, peek } = useMemo(() => cardActions(item, onOpen, onPeek), [item, onOpen, onPeek]);
  // A large tile: the hold stays at the first press scale (0.98).
  const press = useCardPress(open, peek, motion.press.scale);
  const needsYou = item.bucket === "needs_you";
  const working = item.bucket === "working";
  // An SVG id: letters, digits and "-" only.
  const gradId = `fade-${item.key.replace(/[^A-Za-z0-9-]/g, "-")}`;
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
          accessibilityLabel={cardLabel(item)}
          accessibilityHint="Opens the session. Long press to peek."
          accessibilityActions={TILE_A11Y_ACTIONS}
          onAccessibilityAction={(e) => (e.nativeEvent.actionName === "longpress" ? onPeek(item) : onOpen(item))}
          style={{ flex: 1 }}
        >
          <Snapshot item={item} read={read} />
          {needsYou ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.blockedTint }]} /> : null}
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset={FADE_FROM} stopColor={colors.sunken} stopOpacity={0} />
                <Stop offset={FADE_TO} stopColor={colors.sunken} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradId})`} />
          </Svg>
          {(needsYou || working) && item.since !== undefined ? <ElapsedChip since={item.since} /> : null}
          <View style={{ position: "absolute", left: space.lg, right: space.lg, bottom: space.md, gap: 2 }}>
            <Text variant="headline" numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
              {item.title}
            </Text>
            <View style={{ flexDirection: "row" }}>
              <BucketStatus bucket={item.bucket} />
            </View>
            <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
              {item.subtitle}
            </Text>
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
const VIEWABILITY = { itemVisiblePercentThreshold: 10 };
const NEW_KEY = "new";

/**
 * The carousel: a section label ("Highlights" or "Recent"), then the tiles in one row that snaps
 * tile by tile. Only the tiles on screen read their agent's screen. No auto scroll.
 */
export function SpotlightCarousel({
  spot,
  room,
  focused,
  onOpen,
  onPeek,
  onNew,
}: {
  spot: Spotlight;
  /** The width the Board has, in points. */
  room: number;
  focused: boolean;
  onOpen: (i: BoardItem) => void;
  onPeek: (i: BoardItem) => void;
  onNew: () => void;
}) {
  const width = tileWidth(room);
  const data = useMemo<Slot[]>(() => [...spot.items.map((item): Slot => ({ kind: "agent", item })), { kind: "new" }], [spot.items]);
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set());
  // FlatList needs the same callback for its whole life.
  const onViewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    // The keys are the item keys (see `keyExtractor`); "new" is the New session tile.
    setVisible(new Set(viewableItems.flatMap((v) => (v.key && v.key !== NEW_KEY ? [v.key] : []))));
  }).current;
  const renderItem = useCallback(
    ({ item: s }: { item: Slot }) =>
      s.kind === "agent" ? (
        <SpotlightTile item={s.item} width={width} read={focused && visible.has(s.item.key)} onOpen={onOpen} onPeek={onPeek} />
      ) : (
        <NewSessionTile width={width} onPress={onNew} />
      ),
    [width, focused, visible, onOpen, onPeek, onNew],
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
        extraData={visible}
        showsHorizontalScrollIndicator={false}
        snapToInterval={width + TILE_GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: TILE_INSET }}
        ItemSeparatorComponent={TileGap}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={VIEWABILITY}
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
