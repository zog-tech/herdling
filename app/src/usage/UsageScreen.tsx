import type { ProviderUsage } from "@herdling/protocol";
import { useRouter } from "expo-router";
import { CircleAlert, CircleSlash, LogIn, Server, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";

import { timeAgo } from "@/hosts/ConnBadge";
import { retryNow, useHostConn } from "@/hosts/connection";
import { Working } from "@/hosts/flowParts";
import { useHostStats } from "@/hosts/useHostStats";
import { useHosts, type Host } from "@/hosts/store";
import { noteUsage } from "@/settings/usageSummary";
import { colors, icon, state } from "@/theme/tokens";
import { formatBytes, formatResetIn, pct } from "@/ui/format";
import { Group, Pad, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";

import { MeterRow } from "./MeterRow";
import { useUsage } from "./useUsage";

/**
 * The Usage screen (a stack screen that opens from More): per computer, the plan usage of each
 * agent provider and the CPU and memory, each meter as a row of one `Group` (design rule 1).
 * Pull to refresh reads every computer at once. The route file renders `UsageScreen`.
 */

const NAMES = { claude: "Claude", codex: "Codex" } as const;

/** The rows of one provider: a meter per usage window, or one row that says why there is none. */
function providerRows(p: ProviderUsage, nowS: number): ReactNode[] {
  const name = NAMES[p.provider] ?? p.provider;
  if (p.status !== "ok") {
    const Icon = p.status === "not_logged_in" ? LogIn : CircleAlert;
    return [
      <Row
        key={p.provider}
        title={name}
        detail={p.status === "not_logged_in" ? `Not logged in${p.error ? ` (${p.error})` : ""}` : `Unavailable${p.error ? `: ${p.error}` : ""}`}
        leading={<Icon size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
      />,
    ];
  }
  if (p.windows.length === 0) return [<Row key={p.provider} title={name} detail="No usage windows reported." />];
  return p.windows.map((w) => (
    <MeterRow key={`${p.provider}:${w.label}`} label={`${name} · ${w.label}`} value={w.used_pct} detail={formatResetIn(w.resets_at, nowS) || undefined} />
  ));
}

/** One computer: provider usage, then CPU and memory. Registers its refresh so the screen can pull all computers. */
function HostUsage({ host, register }: { host: Host; register: (id: string, fn: (() => Promise<void>) | undefined) => void }) {
  const conn = useHostConn(host.id);
  const online = conn.status === "online";
  const { usage, refresh, failed } = useUsage(host.id);
  const stats = useHostStats(host.id);
  useEffect(() => {
    register(host.id, refresh);
    return () => register(host.id, undefined);
  }, [host.id, refresh, register]);
  // The More index shows the last reading as the value of its Usage row: no extra call.
  useEffect(() => {
    if (usage) noteUsage(host.id, usage);
  }, [host.id, usage]);
  const nowS = Math.floor(Date.now() / 1000);

  let rows: ReactNode[];
  if (!online) {
    rows = [
      <Pad key="offline">
        <StateNotice inline
          Icon={CircleSlash}
          message={conn.status === "connecting" ? "Connecting…" : conn.lastSeen ? `Offline · seen ${timeAgo(conn.lastSeen)}` : "Offline"}
          action={conn.status === "connecting" ? undefined : "Retry"}
          onAction={() => retryNow(host.id)}
        />
      </Pad>,
    ];
  } else {
    rows = usage
      ? usage.providers.flatMap((p) => providerRows(p, nowS))
      : failed
        ? [
            <Pad key="failed">
              <StateNotice inline Icon={TriangleAlert} color={colors.status.blocked} message="Can't read usage." action="Retry" onAction={() => void refresh()} />
            </Pad>,
          ]
        : [
            <Pad key="loading">
              <Working bare text="Loading…" />
            </Pad>,
          ];
    if (stats) {
      rows.push(
        <MeterRow key="cpu" label="CPU" value={stats.cpu_pct} />,
        <MeterRow
          key="mem"
          label="Memory"
          value={pct(stats.mem_used, stats.mem_total)}
          detail={`${formatBytes(stats.mem_used)} of ${formatBytes(stats.mem_total)}`}
        />,
      );
    }
  }

  return (
    <Section title={host.name}>
      <View style={online ? undefined : { opacity: state.offlineOpacity }}>
        <Group>{rows}</Group>
      </View>
    </Section>
  );
}

export function UsageScreen() {
  const router = useRouter();
  const hosts = useHosts((s) => s.hosts);
  const refreshers = useRef(new Map<string, () => Promise<void>>());
  const [refreshing, setRefreshing] = useState(false);
  const register = useCallback((id: string, fn: (() => Promise<void>) | undefined) => {
    if (fn) refreshers.current.set(id, fn);
    else refreshers.current.delete(id);
  }, []);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([...refreshers.current.values()].map((f) => f()));
    } finally {
      setRefreshing(false);
    }
  }, []);
  return (
    <Screen flush refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />}>
      {hosts.length === 0 ? (
        <StateNotice Icon={Server} message="No computers yet." action="Add a computer" onAction={() => router.push("/hosts/discover" as never)} />
      ) : (
        hosts.map((h) => <HostUsage key={h.id} host={h} register={register} />)
      )}
    </Screen>
  );
}

export default UsageScreen;
