import { useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useEffect, useMemo } from "react";
import { Pressable, View } from "react-native";

import { ConnBadge, timeAgo } from "@/hosts/ConnBadge";
import { useHostConn, useOnlineHostKey } from "@/hosts/connection";
import { useHosts, type Host } from "@/hosts/store";
import { pruneSeen, useSeen, useSeenHydrated } from "@/herdr/seen";
import { needsYou, type AgentInfo, type Snapshot } from "@/herdr/snapshot";
import { setHostSnapshot, useSnapshots } from "@/herdr/snapshotStore";
import { useHostSnapshot } from "@/herdr/useHostSnapshot";
import { colors, hitTarget, space } from "@/theme/tokens";
import { Card } from "@/ui/Card";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { StatusBadge } from "@/ui/StatusBadge";
import { Text } from "@/ui/Text";

/** Keeps one host's snapshot live and mirrors it into the shared store. Renders nothing. */
function HostWatcher({ hostId }: { hostId: string }) {
  const { snapshot, error } = useHostSnapshot(hostId);
  useEffect(() => {
    setHostSnapshot(hostId, snapshot, error);
  }, [hostId, snapshot, error]);
  useEffect(() => {
    if (snapshot && !snapshot.stale) pruneSeen(hostId, snapshot.panes.map((p) => p.pane_id));
  }, [hostId, snapshot]);
  useEffect(() => () => setHostSnapshot(hostId, undefined), [hostId]);
  return null;
}

function AgentRow({ hostId, agent, subtitle }: { hostId: string; agent: AgentInfo; subtitle?: string }) {
  const router = useRouter();
  const title = agent.terminal_title_stripped || agent.agent;
  return (
    <Row
      accessibilityLabel={`Open ${title}`}
      onPress={() => router.push(`/session/${hostId}/${agent.pane_id}` as never)}
      trailing={<StatusBadge status={agent.agent_status} />}
    >
      <Text numberOfLines={1} bold>
        {title}
      </Text>
      <Text variant="caption" muted numberOfLines={1}>
        {subtitle ?? agent.agent}
      </Text>
    </Row>
  );
}

function NeedsYouSection({ items, hosts }: { items: ReturnType<typeof needsYou>; hosts: Host[] }) {
  if (items.length === 0) return null;
  const name = (id: string) => hosts.find((h) => h.id === id)?.name ?? id;
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="small" muted>
        NEEDS YOU
      </Text>
      <Card style={{ paddingVertical: space.sm, gap: space.xs }}>
        {items.map(({ hostId, agent }) => (
          <AgentRow key={`${hostId}:${agent.pane_id}`} hostId={hostId} agent={agent} subtitle={`${name(hostId)} · ${agent.agent}`} />
        ))}
      </Card>
    </View>
  );
}

function Workspaces({ hostId, snapshot }: { hostId: string; snapshot: Snapshot }) {
  const groups = snapshot.workspaces
    .map((w) => ({ ws: w, agents: snapshot.agents.filter((a) => a.workspace_id === w.workspace_id) }))
    .filter((g) => g.agents.length > 0);
  if (groups.length === 0)
    return (
      <Text muted variant="small">
        No agents running.
      </Text>
    );
  return (
    <View style={{ gap: space.sm }}>
      {groups.map(({ ws, agents }) => (
        <View key={ws.workspace_id}>
          <Text variant="caption" muted>
            {ws.label}
          </Text>
          {agents.map((a) => (
            <AgentRow key={a.pane_id} hostId={hostId} agent={a} />
          ))}
        </View>
      ))}
    </View>
  );
}

function HostCard({ host }: { host: Host }) {
  const conn = useHostConn(host.id);
  const snapshot = useSnapshots((s) => s.byHost[host.id]);
  const error = useSnapshots((s) => s.errors[host.id]);
  const online = conn.status === "online";
  return (
    <Card style={online ? undefined : { opacity: 0.6 }}>
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
      {online ? (
        snapshot ? (
          <Workspaces hostId={host.id} snapshot={snapshot} />
        ) : error ? (
          <Text muted variant="small">
            Can't read herdr
          </Text>
        ) : (
          <Text muted variant="small">
            Loading…
          </Text>
        )
      ) : null}
    </Card>
  );
}

/** Ids of hosts whose connection is online. */
function useOnlineHostIds(hosts: Host[]): Set<string> {
  const key = useOnlineHostKey(hosts.map((h) => h.id));
  return useMemo(() => new Set(key.split(",").filter(Boolean)), [key]);
}

export default function OverviewScreen() {
  const router = useRouter();
  const hosts = useHosts((s) => s.hosts);
  const byHost = useSnapshots((s) => s.byHost);
  const seen = useSeen((s) => s.seen);
  const online = useOnlineHostIds(hosts);
  const hydrated = useSeenHydrated();
  const items = useMemo(
    () =>
      hydrated
        ? needsYou(
            hosts.flatMap((h) => (online.has(h.id) && byHost[h.id] ? [{ hostId: h.id, snapshot: byHost[h.id] }] : [])),
            seen,
          )
        : [],
    [hosts, byHost, seen, online, hydrated],
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {hosts.map((h) => (
        <HostWatcher key={h.id} hostId={h.id} />
      ))}
      <Screen>
        <NeedsYouSection items={items} hosts={hosts} />
        {hosts.length === 0 ? (
          <Text muted>No hosts yet. Add one in Settings.</Text>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text variant="small" muted>
              HOSTS
            </Text>
            {hosts.map((h) => (
              <HostCard key={h.id} host={h} />
            ))}
          </View>
        )}
        {/* Room so the floating button never covers the last card. */}
        <View style={{ height: 56 }} />
      </Screen>
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
          borderRadius: 28,
          backgroundColor: colors.accent,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Plus color={colors.bg} size={28} />
      </Pressable>
    </View>
  );
}
