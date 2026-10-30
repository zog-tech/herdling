import { useIsFocused, useNavigation, useRouter } from "expo-router";
import { CircleSlash, Ellipsis, ListFilter, Loader, Moon, Plus, Server, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActionSheetIOS, Alert, Pressable, SectionList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AgentCard } from "@/board/AgentCard";
import { useBucketAnnouncements } from "@/board/announce";
import { BoardChips } from "@/board/BoardChips";
import { setFilter, setGroupBy, updateFirstSeen, useBoard } from "@/board/boardStore";
import { BUCKET_META } from "@/board/bucketMeta";
import { countBuckets, filterBoard, groupBoard, mergeBoard, type BoardItem, type GroupBy } from "@/board/buckets";
import { usePreviewPolling } from "@/board/usePreviewPolling";
import { confirmRestart, restartConfirmed } from "@/herdr/confirmActions";
import { promptRename, renameItems, renameSupported, type MenuItem } from "@/herdr/rename";
import { markSeen, pruneSeen, useSeen, useSeenHydrated } from "@/herdr/seen";
import { setHostSnapshot, useSnapshots } from "@/herdr/snapshotStore";
import { useHostSnapshot } from "@/herdr/useHostSnapshot";
import { ConnBadge, timeAgo } from "@/hosts/ConnBadge";
import { HostMeters } from "@/hosts/HostMeters";
import { needsZogsshdUpdate, UPDATE_ZOGSSHD_HINT } from "@/hosts/methods";
import { getHostConn, retryNow, useHostConn, useOnlineHostKey } from "@/hosts/connection";
import { useHosts, type Host } from "@/hosts/store";
import { colors, denseScale, hitTarget, radius, space, state } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

/** Pills show seconds; refresh the clock this often while the Board is visible. */
const CLOCK_MS = 5_000;
const GROUP_LABEL: Record<GroupBy, string> = { status: "Status", host: "Host", workspace: "Workspace" };
const GROUPS: GroupBy[] = ["status", "host", "workspace"];

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

/** Connection state, meters and herdr errors of one host, under the cards. */
function HostCard({ host }: { host: Host }) {
  const conn = useHostConn(host.id);
  const snapshot = useSnapshots((s) => s.byHost[host.id]);
  const error = useSnapshots((s) => s.errors[host.id]);
  const online = conn.status === "online";
  return (
    <Card style={online ? undefined : { opacity: state.offlineOpacity }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={1}>
            {host.name}
          </Text>
          {!online && conn.status === "offline" ? (
            <Text variant="small" muted>
              {conn.lastSeen ? `Offline · seen ${timeAgo(conn.lastSeen)}` : "Offline"}
            </Text>
          ) : null}
        </View>
        <ConnBadge status={conn.status} />
      </View>
      {online ? <HostMeters hostId={host.id} /> : null}
      {online && needsZogsshdUpdate(conn.hello) ? (
        <Text variant="small" muted>
          {UPDATE_ZOGSSHD_HINT}
        </Text>
      ) : null}
      {online && !snapshot ? (
        <Text muted variant="small">
          {error ? "Can't read herdr" : "Loading…"}
        </Text>
      ) : null}
    </Card>
  );
}

/** Hosts that are not fully there: not online, or online but herdr unreadable. */
function useProblemHosts(hosts: Host[], online: Set<string>): Host[] {
  const errors = useSnapshots((s) => s.errors);
  const byHost = useSnapshots((s) => s.byHost);
  return useMemo(() => hosts.filter((h) => !online.has(h.id) || (errors[h.id] && !byHost[h.id])), [hosts, online, errors, byHost]);
}

/** Compact strip above the chips: one short sentence per host that is offline, connecting or can't read herdr. */
function HostStrip({ hosts }: { hosts: Host[] }) {
  if (hosts.length === 0) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: space.lg,
        marginTop: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.divider,
        backgroundColor: colors.card,
      }}
    >
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 }}>
      <Icon size={14} color={color} />
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

/** Wall clock that ticks every `ms` while `on`. */
function useNow(ms: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

function SectionHeader({ title, bucket, onMenu }: { title: string; bucket?: BoardItem["bucket"]; onMenu?: () => void }) {
  const meta = bucket ? BUCKET_META[bucket] : undefined;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.lg,
        paddingTop: space.md,
        paddingBottom: space.sm,
        backgroundColor: colors.bg,
      }}
    >
      {meta ? <meta.Icon size={14} color={meta.color} /> : <Server size={14} color={colors.textMuted} />}
      {/* Small caps style in stone; the icon keeps the bucket color. */}
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
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <Ellipsis size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Calm({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md }}>
      <Moon size={16} color={colors.textMuted} />
      <Text muted>{text}</Text>
    </View>
  );
}

export default function BoardScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const hosts = useHosts((s) => s.hosts);
  const byHost = useSnapshots((s) => s.byHost);
  const seen = useSeen((s) => s.seen);
  const hydrated = useSeenHydrated();
  const online = useOnlineHostIds(hosts);
  const problemHosts = useProblemHosts(hosts, online);
  const { previews, firstSeen, filter, groupBy } = useBoard();
  const now = useNow(CLOCK_MS, focused);

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
  useBucketAnnouncements(items, focused);
  const sections = useMemo(() => groupBoard(filterBoard(items, filter), groupBy), [items, filter, groupBy]);

  const pickGroup = useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "Group by", options: [...GROUPS.map((g) => GROUP_LABEL[g]), "Cancel"], cancelButtonIndex: GROUPS.length },
      (i) => {
        if (GROUPS[i]) setGroupBy(GROUPS[i]);
      },
    );
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Group by ${GROUP_LABEL[groupBy]}`}
          accessibilityHint="Changes how the agents are grouped"
          onPress={pickGroup}
          style={{ minWidth: hitTarget, minHeight: hitTarget, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.md }}
        >
          <ListFilter size={18} color={colors.text} />
          <Text variant="small" maxFontSizeMultiplier={denseScale.row}>
            {GROUP_LABEL[groupBy]}
          </Text>
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
      ActionSheetIOS.showActionSheetWithOptions(
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
    ActionSheetIOS.showActionSheetWithOptions({ options: ["Rename workspace", "Cancel"], cancelButtonIndex: 1 }, (k) => {
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
                bucket={section.bucket}
                onMenu={ws && renameSupported(ws.hostId, "workspace") ? () => onWorkspaceMenu(ws.hostId, ws.workspaceId) : undefined}
              />
            );
          }}
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
              <AgentCard
                item={item}
                now={now}
                onOpen={onOpen}
                onPeek={onPeek}
                onMarkRead={onMarkRead}
                onReply={onReply}
                onRestart={onRestart}
                onMenu={onMenu}
              />
            </View>
          )}
          ListHeaderComponent={
            <View>
              <HostStrip hosts={problemHosts} />
              <BoardChips counts={counts} filter={filter} onChange={setFilter} />
              {quiet && filter === null ? <Calm text="All quiet. Nothing needs you." /> : null}
              {items.length === 0 && online.size > 0 ? <Calm text="No agents running." /> : null}
              {items.length > 0 && filter !== null && sections.length === 0 ? (
                <Calm text={`Nothing ${filter === "needs_you" ? "needs you" : `is ${filter}`} right now.`} />
              ) : null}
            </View>
          }
          ListFooterComponent={
            // Room so the floating button never covers the last card.
            <View style={{ gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: 56 + space.lg + insets.bottom }}>
              <Text variant="section" accessibilityRole="header">
                HOSTS
              </Text>
              {hosts.map((h) => (
                <HostCard key={h.id} host={h} />
              ))}
            </View>
          }
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New session"
        onPress={() => router.push("/new" as never)}
        style={({ pressed }) => ({
          position: "absolute",
          right: space.lg,
          bottom: space.lg,
          width: 56,
          height: 56,
          minHeight: hitTarget,
          borderRadius: radius.pill,
          backgroundColor: pressed ? colors.accentPressed : colors.accent,
          alignItems: "center",
          justifyContent: "center",
        })}
      >
        <Plus color={colors.onAccent} size={28} />
      </Pressable>
    </View>
  );
}
