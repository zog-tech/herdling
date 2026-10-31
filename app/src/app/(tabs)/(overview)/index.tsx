import { useIsFocused, useNavigation, useRouter } from "expo-router";
import { CircleSlash, Ellipsis, ListFilter, Loader, Play, Plus, Server, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { Alert, Pressable, SectionList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentRow } from "@/board/AgentRow";
import { DemoTag } from "@/demo/DemoTag";
import { isDemoHost, startDemo } from "@/demo/demoHost";
import { useBucketAnnouncements } from "@/board/announce";
import { BoardChips } from "@/board/BoardChips";
import { setFilter, setGroupBy, updateFirstSeen, useBoard } from "@/board/boardStore";
import { BUCKET_META } from "@/board/bucketMeta";
import { countBuckets, filterBoard, groupBoard, mergeBoard, type BoardItem, type GroupBy } from "@/board/buckets";
import { boardSummary, type BoardSummary } from "@/board/summary";
import { usePreviewPolling } from "@/board/usePreviewPolling";
import { confirmRestart, restartConfirmed } from "@/herdr/confirmActions";
import { promptRename, renameItems, renameSupported, type MenuItem } from "@/herdr/rename";
import { markSeen, pruneSeen, useSeen, useSeenHydrated } from "@/herdr/seen";
import { setHostSnapshot, useSnapshots } from "@/herdr/snapshotStore";
import { useHostSnapshot } from "@/herdr/useHostSnapshot";
import { ConnStatus, timeAgo } from "@/hosts/ConnBadge";
import { HostMeters } from "@/hosts/HostMeters";
import { UpdateNotice } from "@/hosts/UpdateNotice";
import { getHostConn, retryNow, useHostConn, useOnlineHostKey } from "@/hosts/connection";
import { useHosts, type Host } from "@/hosts/store";
import { colors, denseScale, hitTarget, icon, space, state } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { GlassButton } from "@/ui/GlassButton";
import { Divider } from "@/ui/Group";
import { showActionSheet } from "@/ui/nativeSheet";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

const GROUP_LABEL: Record<GroupBy, string> = { status: "Status", host: "Host", workspace: "Workspace" };
const GROUPS: GroupBy[] = ["status", "host", "workspace"];
/** The floating "+" button: its size, and the room the list keeps under the last row. */
const FAB = 56;

/** Keeps one host's snapshot live and mirrors it into the shared store; polls previews while the Board is focused. */
function HostWatcher({ hostId, focused }: { hostId: string; focused: boolean }) {
  const { snapshot, error } = useHostSnapshot(hostId);
  usePreviewPolling(hostId, focused);
  useEffect(() => {
    setHostSnapshot(hostId, snapshot, error);
  }, [hostId, snapshot, error]);
  useEffect(() => {
    if (snapshot && !snapshot.stale) pruneSeen(hostId, snapshot.panes.map((p) => p.pane_id));
  }, [hostId, snapshot]);
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
      ? `${host.name} · can't read herdr`
      : conn.status === "connecting"
        ? `${host.name} is connecting…`
        : conn.lastSeen
          ? `${host.name} is offline · seen ${timeAgo(conn.lastSeen)}`
          : `${host.name} is offline`;
  const Icon = conn.status === "online" ? TriangleAlert : conn.status === "connecting" ? Loader : CircleSlash;
  const color = conn.status === "online" ? colors.status.blocked : colors.textMuted;
  if (conn.status !== "connecting") {
    return <StateNotice Icon={Icon} color={color} message={text} action="Retry" onAction={() => retryNow(host.id)} />;
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

const TONE_COLOR: Record<BoardSummary["tone"], string> = {
  needs_you: BUCKET_META.needs_you.color,
  working: BUCKET_META.working.color,
  ready: BUCKET_META.ready.color,
  quiet: colors.textMuted,
};

/**
 * The headline of the Board: one large number in ivory and the words after it in the bucket color,
 * then the other buckets in one muted line. No box.
 */
function Summary({ summary }: { summary: BoardSummary }) {
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={summary.spoken}
      style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, gap: 2 }}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: space.sm }}>
        <Text variant="display">{summary.value}</Text>
        <Text variant="title" color={TONE_COLOR[summary.tone]}>
          {summary.label}
        </Text>
      </View>
      {summary.detail ? (
        <Text variant="small" muted>
          {summary.detail}
        </Text>
      ) : null}
    </View>
  );
}

function SectionHeader({ title, onMenu }: { title: string; onMenu?: () => void }) {
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
      <Text accessibilityRole="header" variant="section" numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flex: 1 }}>
        {title}
      </Text>
      {onMenu ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Workspace actions for ${title}`}
          onPress={onMenu}
          style={({ pressed }) => ({
            width: hitTarget,
            height: hitTarget,
            marginVertical: -space.md,
            marginRight: -space.md,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <Ellipsis size={icon.sm + 2} color={colors.textMuted} />
        </Pressable>
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

export default function BoardScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const hosts = useHosts((s) => s.hosts);
  const byHost = useSnapshots((s) => s.byHost);
  const seen = useSeen((s) => s.seen);
  const hydrated = useSeenHydrated();
  const online = useOnlineHostIds(hosts);
  const problemHosts = useProblemHosts(hosts, online);
  const { previews, firstSeen, filter, groupBy } = useBoard();

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
  const sections = useMemo(() => groupBoard(filterBoard(items, filter), groupBy), [items, filter, groupBy]);

  const pickGroup = useCallback(() => {
    showActionSheet(
      { title: "Group by", options: [...GROUPS.map((g) => GROUP_LABEL[g]), "Cancel"], cancelButtonIndex: GROUPS.length },
      (i) => {
        if (GROUPS[i]) setGroupBy(GROUPS[i]);
      },
    );
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      // A plain icon: iOS 26 puts it on Liquid Glass in the header.
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Group by ${GROUP_LABEL[groupBy]}`}
          accessibilityHint="Changes how the agents are grouped"
          onPress={pickGroup}
          style={({ pressed }) => ({
            width: hitTarget,
            height: hitTarget,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <ListFilter size={icon.md} color={colors.text} strokeWidth={icon.strokeWidth} />
        </Pressable>
      ),
    });
  }, [navigation, groupBy, pickGroup]);

  const onOpen = useCallback((i: BoardItem) => router.push(`/session/${i.hostId}/${i.agent.pane_id}` as never), [router]);
  const onPeek = useCallback((i: BoardItem) => router.push(`/peek/${i.hostId}/${i.agent.pane_id}` as never), [router]);
  const onReply = useCallback(
    (i: BoardItem) => router.push(`/peek/${i.hostId}/${i.agent.pane_id}?reply=1` as never),
    [router],
  );
  const onMarkRead = useCallback((i: BoardItem) => {
    // No haptic here: the swipe gave one when it passed the action point.
    markSeen(i.hostId, i.agent.pane_id, i.agent.state_change_seq);
  }, []);
  const onRestart = useCallback(
    async (i: BoardItem) => {
      const { rpc } = getHostConn(i.hostId);
      if (!rpc || !(await confirmRestart())) return;
      try {
        await restartConfirmed(rpc, i.agent, (paneId) => router.push(`/session/${i.hostId}/${paneId}` as never));
      } catch (e) {
        Alert.alert("Can't restart", e instanceof Error ? e.message : String(e));
      }
    },
    [router],
  );

  const onMenu = useCallback(
    (i: BoardItem) => {
      const { rpc } = getHostConn(i.hostId);
      const menu: MenuItem[] = [
        { label: "Reply", onPick: () => onReply(i) },
        { label: "Peek", onPick: () => onPeek(i) },
      ];
      if (i.bucket === "ready") menu.push({ label: "Mark read", onPick: () => onMarkRead(i) });
      if (rpc) menu.push(...renameItems(rpc, i.hostId, i.agent));
      menu.push({ label: "Restart", destructive: true, onPick: () => void onRestart(i) });
      showActionSheet(
        {
          title: i.title,
          options: [...menu.map((m) => m.label), "Cancel"],
          cancelButtonIndex: menu.length,
          destructiveButtonIndex: menu.flatMap((m, k) => (m.destructive ? [k] : [])),
        },
        (k) => menu[k]?.onPick(),
      );
    },
    [onReply, onPeek, onMarkRead, onRestart],
  );

  const onWorkspaceMenu = useCallback((hostId: string, workspaceId: string) => {
    const { rpc } = getHostConn(hostId);
    if (!rpc) return;
    showActionSheet({ options: ["Rename workspace", "Cancel"], cancelButtonIndex: 1 }, (k) => {
      if (k === 0) promptRename(rpc, hostId, "workspace", { workspace_id: workspaceId, tab_id: "", pane_id: "" });
    });
  }, []);

  const quiet = items.length > 0 && counts.needs_you + counts.ready + counts.working === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {hosts.map((h) => (
        <HostWatcher key={h.id} hostId={h.id} focused={focused} />
      ))}
      {hosts.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg, padding: space.xl }}>
          <Server size={32} color={colors.textMuted} />
          <Text muted style={{ textAlign: "center" }}>
            No hosts yet. Add one to see its agents here.
          </Text>
          <Button label="Add a host" Icon={Plus} onPress={() => router.push("/hosts/discover" as never)} />
          <Text variant="small" muted style={{ textAlign: "center" }}>
            No computer with herdlingd yet? The demo shows sample agents. It runs inside the app.
          </Text>
          <Button label="Try the demo" variant="secondary" Icon={Play} onPress={() => void startDemo()} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.key}
          stickySectionHeadersEnabled
          contentInsetAdjustmentBehavior="automatic"
          renderSectionHeader={({ section }) => {
            const ws = section.workspace;
            return (
              <SectionHeader
                title={section.title}
                onMenu={ws && renameSupported(ws.hostId, "workspace") ? () => onWorkspaceMenu(ws.hostId, ws.workspaceId) : undefined}
              />
            );
          }}
          ItemSeparatorComponent={Divider}
          renderItem={({ item }) => (
            <AgentRow
              item={item}
              onOpen={onOpen}
              onPeek={onPeek}
              onMarkRead={onMarkRead}
              onReply={onReply}
              onRestart={onRestart}
              onMenu={onMenu}
            />
          )}
          ListHeaderComponent={
            <View>
              {items.length > 0 ? <Summary summary={summary} /> : null}
              <HostStrip hosts={problemHosts} />
              {items.length > 0 ? <BoardChips counts={counts} filter={filter} onChange={setFilter} /> : null}
              {quiet && filter === null ? <Calm text="All quiet. Nothing needs you." /> : null}
              {items.length === 0 && online.size > 0 ? <Calm text="No agents running." /> : null}
              {items.length > 0 && filter !== null && sections.length === 0 ? (
                <Calm text={`Nothing ${filter === "needs_you" ? "needs you" : `is ${filter}`} right now.`} />
              ) : null}
            </View>
          }
          ListFooterComponent={
            // Room so the floating button never covers the last host.
            <View style={{ paddingTop: space.xl, paddingBottom: FAB + space.xl }}>
              <Text variant="section" accessibilityRole="header" style={{ paddingHorizontal: space.lg, paddingBottom: space.xs }}>
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
      {/* The native safe area here includes the tab bar, so the button sits just above it. */}
      <SafeAreaView edges={["bottom"]} pointerEvents="box-none" style={{ position: "absolute", right: 0, bottom: 0 }}>
        <GlassButton
          label="New session"
          Icon={Plus}
          primary
          size={FAB}
          onPress={() => router.push("/new" as never)}
          style={{ margin: space.lg }}
        />
      </SafeAreaView>
    </View>
  );
}
