import { useIsFocused, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { ChevronDown, CircleSlash, Ellipsis, Loader, PanelRight, Pencil, Play, Plus, Server, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, SectionList, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AgentRow } from "@/board/AgentRow";
import { BoardHint } from "@/board/BoardHint";
import { showHint, useBoardPrefs, useBoardPrefsHydrated } from "@/board/boardPrefs";
import { DemoTag } from "@/demo/DemoTag";
import { isDemoHost, startDemo } from "@/demo/demoHost";
import { useBucketAnnouncements } from "@/board/announce";
import { boardAgentMenu, restartAgent, spaceRoute } from "@/board/agentActions";
import { FilterButton, FilterField, NoMatch } from "@/board/BoardFilter";
import { setFilter, setQuery, updateFirstSeen, useBoard } from "@/board/boardStore";
import { collapseSections, collapsible, groupItems, sortItems } from "@/board/arrange";
import { BoardTop } from "@/board/BoardTop";
import { countBuckets, filterBoard, mergeBoard, type BoardItem } from "@/board/buckets";
import { BrandHeader, HostsButton } from "@/board/Dashboard";
import { IconButton } from "@/ui/IconButton";
import { ListBar } from "@/board/ListBar";
import { arrangeLine, listMenu, listTitle } from "@/board/listMenu";
import { spotlight } from "@/board/spotlight";
import { TerminalRows } from "@/board/TerminalRows";
import { boardSummary } from "@/board/summary";
import { filterByText, queryWords } from "@/board/textFilter";
import { usePreviewPolling } from "@/board/usePreviewPolling";
import { renameKindsFor } from "@/herdr/backend";
import { promptRename, renameSupported } from "@/herdr/rename";
import { markSeen, pruneSeen, useSeen, useSeenHydrated } from "@/herdr/seen";
import { useSeenSync } from "@/herdr/seenSync";
import { setHostSnapshot, useSnapshots } from "@/herdr/snapshotStore";
import { boardTerminals, terminalPanes, type BoardTerminal } from "@/herdr/terminals";
import { useTerminalStatusPolling } from "@/herdr/useTerminalStatusPolling";
import { useHostSnapshot } from "@/herdr/useHostSnapshot";
import { ConnStatus, timeAgo } from "@/hosts/ConnBadge";
import { HostMeters } from "@/hosts/HostMeters";
import { UpdateNotice } from "@/hosts/UpdateNotice";
import { getHostConn, retryNow, useHostConn, useOnlineHostKey } from "@/hosts/connection";
import { useHosts, type Host } from "@/hosts/store";
import { setColumnPane } from "@/push/useNotificationRouting";
import { colors, denseScale, hitTarget, icon, motion, space, state } from "@/theme/tokens";
import { SessionDetail } from "@/thread/SessionDetail";
import { ActionBar } from "@/ui/ActionBar";
import { GlassButton } from "@/ui/GlassButton";
import { Divider } from "@/ui/Group";
import * as haptics from "@/ui/haptics";
import { useKeyCommand } from "@/ui/keyCommands";
import { BOARD_COLUMN_WIDTH, selectionFromParams, stepKey, useLayoutClass, type PaneRef } from "@/ui/layout";
import { showMenu } from "@/ui/MenuSheet";
import { useScreenBottomPadding } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

// A render error on the board shows the error screen in the tab. A session on top stays open.
export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

/** The floating "+" button: its size, and the room the list keeps under the last row. */
const FAB = 56;

/** Cards style: the space between two cards. */
function CardGap() {
  return <View style={{ height: space.sm + 2 }} />;
}
/** Cards style: a little space at the top and the bottom of each section. */
function CardSectionGap() {
  return <View style={{ height: space.xs }} />;
}

/**
 * Keeps one host's snapshot live and mirrors it into the shared store; polls previews while the Board is focused.
 * It polls the terminal statuses only while the Terminals section shows (`terminalsShown`).
 */
function HostWatcher({ hostId, focused, terminalsShown }: { hostId: string; focused: boolean; terminalsShown: boolean }) {
  const { snapshot, error } = useHostSnapshot(hostId);
  usePreviewPolling(hostId, focused);
  const terminalIds = useMemo(() => (snapshot ? terminalPanes(snapshot).map((p) => p.pane_id) : []), [snapshot]);
  useTerminalStatusPolling(hostId, terminalIds, focused && terminalsShown);
  useEffect(() => {
    setHostSnapshot(hostId, snapshot, error);
  }, [hostId, snapshot, error]);
  useEffect(() => {
    if (snapshot && !snapshot.stale) pruneSeen(hostId, snapshot.panes.map((p) => p.pane_id));
  }, [hostId, snapshot]);
  useSeenSync(hostId, snapshot);
  useEffect(() => () => setHostSnapshot(hostId, undefined), [hostId]);
  return null;
}

/** One host under the agents: name, connection state, meters and herdr errors. A flat row. */
function HostRow({ host }: { host: Host }) {
  const conn = useHostConn(host.id);
  const snapshot = useSnapshots((s) => s.byHost[host.id]);
  const error = useSnapshots((s) => s.errors[host.id]);
  const online = conn.status === "online";
  return (
    <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm, opacity: online ? 1 : state.offlineOpacity }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {host.name}
          </Text>
          {isDemoHost(host) ? <DemoTag /> : null}
        </View>
        <ConnStatus status={conn.status} />
      </View>
      {!online && conn.status === "offline" && conn.lastSeen ? (
        <Text variant="small" muted>
          Seen {timeAgo(conn.lastSeen)}
        </Text>
      ) : null}
      {online ? <HostMeters hostId={host.id} /> : null}
      {online && !isDemoHost(host) ? <UpdateNotice host={host} conn={conn} /> : null}
      {online && !snapshot ? (
        <Text muted variant="small">
          {error ? "Can't read herdr" : "Loading…"}
        </Text>
      ) : null}
    </View>
  );
}

/** Hosts that are not fully there: not online, or online but herdr unreadable. */
function useProblemHosts(hosts: Host[], online: Set<string>): Host[] {
  const errors = useSnapshots((s) => s.errors);
  const byHost = useSnapshots((s) => s.byHost);
  return useMemo(() => hosts.filter((h) => !online.has(h.id) || (errors[h.id] && !byHost[h.id])), [hosts, online, errors, byHost]);
}

/** One short line per host that is offline, connecting or can't read herdr. No box. */
function HostStrip({ hosts }: { hosts: Host[] }) {
  if (hosts.length === 0) return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg }}>
      {hosts.map((h) => (
        <HostStripRow key={h.id} host={h} />
      ))}
    </View>
  );
}

function HostStripRow({ host }: { host: Host }) {
  const conn = useHostConn(host.id);
  const text =
    conn.status === "online"
      ? conn.hello && !conn.hello.herdr_ok
        ? `herdr is not running on ${host.name}`
        : `${host.name} · can't read herdr`
      : conn.status === "connecting"
        ? `${host.name} is connecting…`
        : conn.lastSeen
          ? `${host.name} is offline · seen ${timeAgo(conn.lastSeen)}`
          : `${host.name} is offline`;
  const Icon = conn.status === "online" ? TriangleAlert : conn.status === "connecting" ? Loader : CircleSlash;
  const color = conn.status === "online" ? colors.status.blocked : colors.textMuted;
  if (conn.status !== "connecting") {
    return <StateNotice inline Icon={Icon} color={color} message={text} action="Retry" onAction={() => retryNow(host.id)} />;
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: hitTarget }}>
      <Icon size={icon.sm} color={color} />
      <Text variant="small" color={color} numberOfLines={1} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/** Ids of hosts whose connection is online. */
function useOnlineHostIds(hosts: Host[]): Set<string> {
  const key = useOnlineHostKey(hosts.map((h) => h.id));
  return useMemo(() => new Set(key.split(",").filter(Boolean)), [key]);
}

/** The chevron of a section that can collapse: it points down when open, right when collapsed. Reduce Motion: no turn. */
function CollapseChevron({ collapsed }: { collapsed: boolean }) {
  const reduced = useReducedMotion();
  const deg = collapsed ? -90 : 0;
  const turn = useSharedValue(deg);
  useEffect(() => {
    turn.set(reduced ? deg : withTiming(deg, { duration: motion.stateMs, easing: Easing.bezier(...motion.ease.out) }));
  }, [deg, reduced, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));
  return (
    <Animated.View style={style}>
      <ChevronDown size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
    </Animated.View>
  );
}

/**
 * A section header: the title in small caps. A computer, workspace or folder section also shows its count,
 * and a tap collapses or expands it (VoiceOver: a button with the expanded state).
 */
function SectionHeader({
  title,
  subtitle,
  count,
  collapsed,
  onToggle,
  onMenu,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  onMenu?: () => void;
}) {
  const label = (
    <>
      {onToggle ? <CollapseChevron collapsed={!!collapsed} /> : null}
      <Text variant="section" numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flexShrink: 1 }}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="small" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flexShrink: 2 }}>
          {subtitle}
        </Text>
      ) : null}
      {count !== undefined ? (
        <Text variant="section" maxFontSizeMultiplier={denseScale.row} style={{ fontVariant: ["tabular-nums"] }}>
          {count}
        </Text>
      ) : null}
    </>
  );
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.lg,
        paddingTop: space.lg,
        paddingBottom: space.xs,
        backgroundColor: colors.bg,
      }}
    >
      {onToggle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ""}, ${count ?? 0} ${count === 1 ? "agent" : "agents"}`}
          accessibilityHint={collapsed ? "Shows the agents of this group" : "Hides the agents of this group"}
          accessibilityState={{ expanded: !collapsed }}
          onPress={onToggle}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            minHeight: hitTarget,
            marginVertical: -space.md,
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          {label}
        </Pressable>
      ) : (
        <View accessible accessibilityRole="header" style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          {label}
        </View>
      )}
      {onMenu ? (
        <IconButton
          label={`Workspace actions for ${title}`}
          Icon={Ellipsis}
          color={colors.textMuted}
          onPress={onMenu}
          style={{ marginVertical: -space.md, marginRight: -space.md }}
        />
      ) : null}
    </View>
  );
}

function Calm({ text }: { text: string }) {
  return (
    <Text muted style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
      {text}
    </Text>
  );
}

/** Agents tab search params: the pane in the detail column (regular width), and the session route params it carries. */
type OverviewParams = { host?: string; pane?: string; from?: string; prompt?: string; promptError?: string };

/**
 * The right column in regular width: the selected session, or a short hint. The native header of
 * the Agents tab is transparent on iOS, so the column starts below it.
 */
function DetailColumn({
  selection,
  params,
  headerShown,
  onSelect,
  onClear,
}: {
  selection: PaneRef | null;
  params: OverviewParams;
  /** False in the Dashboard top: the screen already keeps clear of the status bar. */
  headerShown: boolean;
  onSelect: (pane: PaneRef) => void;
  onClear: () => void;
}) {
  const headerHeight = useHeaderHeight();
  const top = headerShown && Platform.OS === "ios" ? headerHeight : 0;
  if (!selection) {
    return (
      <View style={{ flex: 1, paddingTop: top, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}>
        <PanelRight size={icon.lg} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
        <Text muted style={{ textAlign: "center" }}>
          Select an agent to see its session here.
        </Text>
      </View>
    );
  }
  const { hostId, paneId } = selection;
  return (
    <View style={{ flex: 1, paddingTop: top }}>
      {/* A new pane gets a new component: no state (draft, mode, search) leaks from one pane to the next. */}
      <SessionDetail
        key={`${hostId}:${paneId}`}
        hostId={hostId}
        paneId={paneId}
        prompt={params.prompt}
        promptError={params.promptError}
        from={params.from}
        active
        header="inline"
        onOpenPane={(target) => onSelect({ hostId, paneId: target })}
        onClosed={onClear}
      />
    </View>
  );
}

export default function BoardScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const layout = useLayoutClass();
  const regular = layout === "regular";
  const params = useLocalSearchParams<OverviewParams>();
  const selection = useMemo(
    () => (regular ? selectionFromParams({ host: params.host, pane: params.pane }) : null),
    [regular, params.host, params.pane],
  );
  const selectedKey = selection ? `${selection.hostId}:${selection.paneId}` : undefined;
  const select = useCallback(
    (p: PaneRef) => router.setParams({ host: p.hostId, pane: p.paneId, from: undefined, prompt: undefined, promptError: undefined }),
    [router],
  );
  const clearSelection = useCallback(
    () => router.setParams({ host: undefined, pane: undefined, from: undefined, prompt: undefined, promptError: undefined }),
    [router],
  );
  // A push for the pane in the column shows no banner, as on the session screen.
  useEffect(() => {
    setColumnPane(focused ? selection : null);
    return () => setColumnPane(null);
  }, [focused, selection]);
  const hosts = useHosts((s) => s.hosts);
  const byHost = useSnapshots((s) => s.byHost);
  const seen = useSeen((s) => s.seen);
  const hydrated = useSeenHydrated();
  const online = useOnlineHostIds(hosts);
  const problemHosts = useProblemHosts(hosts, online);
  const { previews, firstSeen, filter, query } = useBoard();
  /** The text filter: true while the field shows. It also shows while the query has text. */
  const [filterOpen, setFilterOpen] = useState(false);
  /** True when the user opened the field just now: the box takes the focus. */
  const [filterFocus, setFilterFocus] = useState(false);
  const hasQuery = queryWords(query).length > 0;
  const showFilter = filterOpen || query.length > 0;
  const listRef = useRef<SectionList<BoardItem>>(null);
  const headerHeight = useHeaderHeight();
  const rowStyle = useBoardPrefs((s) => s.rowStyle);
  const homeTop = useBoardPrefs((s) => s.homeTop);
  const groupBy = useBoardPrefs((s) => s.groupBy);
  const sortBy = useBoardPrefs((s) => s.sortBy);
  const collapsedKeys = useBoardPrefs((s) => s.collapsed[s.groupBy]);
  const setGroupBy = useBoardPrefs((s) => s.setGroupBy);
  const setSortBy = useBoardPrefs((s) => s.setSortBy);
  const toggleCollapsed = useBoardPrefs((s) => s.toggleCollapsed);
  const dashboard = homeTop === "dashboard";
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const hintDismissed = useBoardPrefs((s) => s.hintDismissed);
  const dismissHint = useBoardPrefs((s) => s.dismissHint);
  const prefsHydrated = useBoardPrefsHydrated();
  const cards = rowStyle === "cards";

  const boardHosts = useMemo(
    () =>
      hosts.flatMap((h) =>
        online.has(h.id) && byHost[h.id]
          ? [
              {
                hostId: h.id,
                hostName: h.name,
                agents: byHost[h.id].agents,
                workspaces: byHost[h.id].workspaces,
                tabs: byHost[h.id].tabs,
                panes: byHost[h.id].panes,
              },
            ]
          : [],
      ),
    [hosts, byHost, online],
  );

  // The app's own status start times, for agents the companion has no start for.
  useEffect(() => {
    updateFirstSeen(
      boardHosts.flatMap((h) => h.agents.map((a) => ({ key: `${h.hostId}:${a.pane_id}`, status: a.agent_status }))),
      Date.now(),
    );
  }, [boardHosts]);

  const items = useMemo(
    () => mergeBoard(boardHosts, previews, hydrated ? seen : null, firstSeen),
    [boardHosts, previews, hydrated, seen, firstSeen],
  );
  const counts = useMemo(() => countBuckets(items), [items]);
  const summary = useMemo(() => boardSummary(counts), [counts]);
  useBucketAnnouncements(items, focused);
  // Filter, then sort, then group: each group keeps the sorted order.
  const grouped = useMemo(
    () => groupItems(sortItems(filterByText(filterBoard(items, filter), query), sortBy), groupBy),
    [items, filter, query, sortBy, groupBy],
  );
  const sections = useMemo(() => collapseSections(grouped, groupBy, collapsedKeys ?? []), [grouped, groupBy, collapsedKeys]);
  const spot = useMemo(() => spotlight(items), [items]);
  // Panes with no agent: a "Terminals" list after the agent groups, whatever the grouping.
  const terminals = useMemo(() => boardTerminals(boardHosts), [boardHosts]);

  // One button above the list: the status filter, the group and the sort, each with checks.
  const openJump = useCallback(() => router.push("/jump" as never), [router]);
  const openListOptions = useCallback(() => {
    showMenu(listMenu({ counts, filter, groupBy, sortBy, onFilter: setFilter, onGroup: setGroupBy, onSort: setSortBy, onJump: openJump }));
  }, [counts, filter, groupBy, sortBy, setGroupBy, setSortBy, openJump]);

  const openFilter = useCallback(() => {
    setFilterOpen(true);
    setFilterFocus(true);
    // The field is at the top of the list: scroll up so the user sees it. iOS keeps the list under the transparent header.
    const top = !dashboard && Platform.OS === "ios" ? -headerHeight : 0;
    listRef.current?.getScrollResponder()?.scrollTo({ y: top, animated: false });
  }, [dashboard, headerHeight]);
  const closeFilter = useCallback(() => {
    setFilterOpen(false);
    setFilterFocus(false);
    setQuery("");
    Keyboard.dismiss();
  }, []);
  const toggleFilter = useCallback(() => {
    haptics.tap();
    if (showFilter) closeFilter();
    else openFilter();
  }, [showFilter, closeFilter, openFilter]);


  useLayoutEffect(() => {
    // The Dashboard top draws its own brand header with the group and sort menus under the carousel.
    if (dashboard) {
      navigation.setOptions({ headerShown: false, headerRight: undefined });
      return;
    }
    navigation.setOptions({
      headerShown: true,
      // One plain icon: iOS 26 puts it on Liquid Glass in the header. The list options button
      // (with "Jump to a terminal") sits in the bar above the list, in both top forms.
      headerRight: () => (hosts.length > 0 ? <FilterButton open={showFilter} onPress={toggleFilter} /> : null),
    });
  }, [navigation, dashboard, showFilter, toggleFilter, hosts.length]);

  // Regular width: the session opens in the detail column. Compact width: it is a pushed screen.
  const openPane = useCallback(
    (hostId: string, paneId: string) => (regular ? select({ hostId, paneId }) : router.push(`/session/${hostId}/${paneId}` as never)),
    [regular, select, router],
  );
  // The user found out that a row opens the session: the first-run hint goes away for good.
  const onOpen = useCallback(
    (i: BoardItem) => {
      dismissHint();
      openPane(i.hostId, i.agent.pane_id);
    },
    [openPane, dismissHint],
  );

  // ⌘[ and ⌘] move the selection on the board, in the order the board shows.
  const order = useMemo(
    () =>
      new Map<string, PaneRef>(
        sections.flatMap((s) => s.data.map((i): [string, PaneRef] => [`${i.hostId}:${i.agent.pane_id}`, { hostId: i.hostId, paneId: i.agent.pane_id }])),
      ),
    [sections],
  );
  const stepSelection = (dir: 1 | -1) => {
    const key = stepKey([...order.keys()], selectedKey, dir);
    const pane = key === undefined || key === selectedKey ? undefined : order.get(key);
    if (pane) select(pane);
  };
  useKeyCommand("prevAgent", () => stepSelection(-1), { enabled: focused && regular });
  useKeyCommand("nextAgent", () => stepSelection(1), { enabled: focused && regular });
  useKeyCommand("refresh", () => problemHosts.forEach((h) => retryNow(h.id)), { enabled: focused });
  // ⌘F filters the board. With a session in the detail column, ⌘F searches that session instead.
  useKeyCommand("find", openFilter, { enabled: focused && hosts.length > 0 && !selection });
  const onOpenTerminal = useCallback((t: BoardTerminal) => openPane(t.hostId, t.paneId), [openPane]);
  const onPeek = useCallback((i: BoardItem) => router.push(`/peek/${i.hostId}/${i.agent.pane_id}` as never), [router]);
  const onReply = useCallback(
    (i: BoardItem) => router.push(`/peek/${i.hostId}/${i.agent.pane_id}?reply=1` as never),
    [router],
  );
  const onMarkRead = useCallback((i: BoardItem) => {
    // No haptic here: the swipe gave one when it passed the action point.
    markSeen(i.hostId, i.agent.pane_id, i.agent.state_change_seq ?? 0);
  }, []);
  const onRestart = useCallback(
    (i: BoardItem) => void restartAgent(i, openPane, (path) => router.push(path as never)),
    [openPane, router],
  );

  // The "⋯" button and the long press menu of a row: the same agent menu as the peek sheet.
  const onMenu = useCallback(
    (i: BoardItem) =>
      showMenu(
        boardAgentMenu(i, {
          reply: () => onReply(i),
          peek: () => onPeek(i),
          openSpace: () => router.push(spaceRoute(i) as never),
          markRead: () => onMarkRead(i),
          restart: () => onRestart(i),
        }),
      ),
    [onReply, onPeek, onMarkRead, onRestart, router],
  );

  const onWorkspaceMenu = useCallback((hostId: string, workspaceId: string, name: string) => {
    const { rpc } = getHostConn(hostId);
    if (!rpc) return;
    showMenu({
      title: name,
      sections: [
        {
          items: [
            {
              label: "Rename workspace",
              Icon: Pencil,
              onPick: () => promptRename(rpc, hostId, "workspace", { workspace_id: workspaceId, tab_id: "", pane_id: "" }),
            },
          ],
        },
      ],
    });
  }, []);

  const hint = showHint({ hydrated: prefsHydrated, dismissed: hintDismissed, agents: items.length });
  const firstKey = sections[0]?.data[0]?.key;

  const heading = listTitle(counts, filter);
  // The list ends above the tab bar and the floating "+" (its size and its margin).
  const listEnd = useScreenBottomPadding(insets.bottom + space.lg + FAB);

  const quiet = items.length > 0 && counts.needs_you + counts.ready + counts.working === 0;
  const newSession = useCallback(() => router.push("/new" as never), [router]);

  const board = (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {dashboard ? (
        <BrandHeader
          right={
            <>
              {hosts.length > 0 ? <FilterButton open={showFilter} onPress={toggleFilter} /> : null}
              <HostsButton hosts={hosts} online={online} onPress={() => router.navigate("/settings/computers" as never)} />
            </>
          }
        />
      ) : null}
      {hosts.length === 0 ? (
        // No computer yet: one sentence in the middle, the two ways to start in the bottom bar.
        <>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}>
            <Server size={icon.lg} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
            <Text muted style={{ textAlign: "center" }}>
              No computers yet. Add one to see its agents here.
            </Text>
            <Text variant="small" muted style={{ textAlign: "center" }}>
              No computer with herdlingd yet? The demo shows sample agents. It runs inside the app.
            </Text>
          </View>
          <ActionBar
            primary={{ label: "Add a computer", Icon: Plus, onPress: () => router.push("/hosts/discover" as never) }}
            secondary={{ label: "Try the demo", Icon: Play, onPress: () => void startDemo() }}
          />
        </>
      ) : (
        <SectionList
          ref={listRef}
          sections={sections}
          // A tap on a row works at once while the filter box has the keyboard.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          keyExtractor={(i) => i.key}
          stickySectionHeadersEnabled
          contentInsetAdjustmentBehavior="automatic"
          renderSectionHeader={({ section }) => {
            // "None": one flat list with no header.
            if (groupBy === "none") return null;
            const ws = section.workspace;
            const folds = collapsible(groupBy);
            return (
              <SectionHeader
                title={section.title}
                subtitle={section.subtitle}
                count={folds ? section.count : undefined}
                collapsed={section.collapsed}
                onToggle={folds ? () => toggleCollapsed(groupBy, section.key) : undefined}
                onMenu={ws && renameKindsFor(ws.workspaceId, ws.hostId).includes("workspace") && renameSupported(ws.hostId, "workspace") ? () => onWorkspaceMenu(ws.hostId, ws.workspaceId, section.title) : undefined}
              />
            );
          }}
          ItemSeparatorComponent={cards ? CardGap : Divider}
          SectionSeparatorComponent={cards ? CardSectionGap : undefined}
          extraData={`${selectedKey}|${rowStyle}|${hint}|${terminals.length}`}
          renderItem={({ item }) => (
            <>
              {/* The first-run hint sits above the first agent, under the first section header. */}
              {hint && item.key === firstKey ? <BoardHint onClose={dismissHint} /> : null}
              <AgentRow
                item={item}
                selected={selectedKey === `${item.hostId}:${item.agent.pane_id}`}
                rowStyle={rowStyle}
                onOpen={onOpen}
                onPeek={onPeek}
                onMarkRead={onMarkRead}
                onReply={onReply}
                onRestart={onRestart}
                onMenu={onMenu}
              />
            </>
          )}
          ListHeaderComponent={
            <View>
              <BoardTop
                mode={homeTop}
                items={items}
                summary={summary}
                spot={spot}
                room={regular ? BOARD_COLUMN_WIDTH : windowWidth}
                focused={focused}
                multiHost={online.size > 1}
                bar={
                  <ListBar
                    title={heading.title}
                    count={heading.count}
                    arrange={arrangeLine(groupBy, sortBy)}
                    filtered={filter !== null}
                    onOptions={openListOptions}
                    onClear={() => setFilter(null)}
                  />
                }
                onOpen={onOpen}
                onPeek={onPeek}
                onNew={newSession}
              />
              <HostStrip hosts={problemHosts} />
              {showFilter ? <FilterField query={query} onQuery={setQuery} onClose={closeFilter} autoFocus={filterFocus} /> : null}
              {quiet && filter === null && !hasQuery ? <Calm text="All quiet. Nothing needs you." /> : null}
              {items.length === 0 && online.size > 0 ? <Calm text="No agents running." /> : null}
              {items.length > 0 && hasQuery && sections.length === 0 ? <NoMatch query={query} onClear={() => setQuery("")} /> : null}
              {items.length > 0 && filter !== null && !hasQuery && sections.length === 0 ? (
                <StateNotice
                  Icon={CircleSlash}
                  message={`Nothing ${filter === "needs_you" ? "needs you" : `is ${filter}`} right now.`}
                  action="Show all"
                  onAction={() => setFilter(null)}
                />
              ) : null}
            </View>
          }
          ListFooterComponent={
            // The last host ends above the tab bar and the floating button.
            <View style={{ paddingBottom: listEnd }}>
              {/* A status or text filter shows agents only. */}
              {filter === null && !hasQuery ? (
                <TerminalRows terminals={terminals} multiHost={online.size > 1} selectedKey={selectedKey} onOpen={onOpenTerminal} />
              ) : null}
              <Text variant="section" accessibilityRole="header" style={{ paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xs }}>
                Hosts
              </Text>
              {hosts.map((h, i) => (
                <View key={h.id}>
                  {i > 0 ? <Divider /> : null}
                  <HostRow host={h} />
                </View>
              ))}
            </View>
          }
        />
      )}
      {/* The one primary way to start: the gold "+" floats over the list. The native safe area here
          includes the tab bar, so the button sits just above it. With no host, the bottom bar
          has the primary action instead. */}
      {hosts.length > 0 ? (
        <SafeAreaView edges={["bottom"]} pointerEvents="box-none" style={{ position: "absolute", right: 0, bottom: 0 }}>
          <GlassButton
            label="New session"
            accessibilityHint="Starts an agent on a computer"
            Icon={Plus}
            primary
            size={FAB}
            onPress={newSession}
            style={{ margin: space.lg }}
          />
        </SafeAreaView>
      ) : null}
    </View>
  );

  return (
    // With no native header (the Dashboard top), the screen keeps clear of the status bar itself.
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: dashboard ? insets.top : 0 }}>
      {hosts.map((h) => (
        <HostWatcher key={h.id} hostId={h.id} focused={focused} terminalsShown={filter === null && !hasQuery} />
      ))}
      {regular ? (
        // Two columns: the board at a fixed width, the selected session in the rest.
        // The iPad sidebar floats over the content and sets the left safe area: keep the board clear of it.
        <SafeAreaView edges={["left", "right"]} style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ width: BOARD_COLUMN_WIDTH }}>{board}</View>
          <View style={{ width: 1, backgroundColor: colors.divider }} />
          <DetailColumn selection={selection} params={params} headerShown={!dashboard} onSelect={select} onClear={clearSelection} />
        </SafeAreaView>
      ) : (
        board
      )}
    </View>
  );
}
