import type { ProviderUsage } from "@zogssh/protocol";
import { CircleAlert, LogIn } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, View } from "react-native";

import { useHostConn } from "@/hosts/connection";
import { HostMeters } from "@/hosts/HostMeters";
import { useHosts, type Host } from "@/hosts/store";
import { colors, space, state } from "@/theme/tokens";
import { useUsage } from "@/usage/useUsage";
import { Card } from "@/ui/Card";
import { formatResetIn } from "@/ui/format";
import { Meter } from "@/ui/Meter";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const NAMES = { claude: "Claude", codex: "Codex" } as const;

function ProviderRows({ p, nowS }: { p: ProviderUsage; nowS: number }) {
  const Icon = p.status === "not_logged_in" ? LogIn : CircleAlert;
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="small" bold>
        {NAMES[p.provider] ?? p.provider}
      </Text>
      {p.status === "ok" ? (
        p.windows.length === 0 ? (
          <Text variant="small" muted>
            No usage windows reported.
          </Text>
        ) : (
          p.windows.map((w) => {
            const reset = formatResetIn(w.resets_at, nowS);
            return (
              <View key={w.label} style={{ gap: space.xs }}>
                <Meter label={w.label} value={w.used_pct} />
                {reset ? (
                  <Text variant="caption" muted>
                    {reset}
                  </Text>
                ) : null}
              </View>
            );
          })
        )
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Icon size={16} color={colors.textMuted} />
          <Text variant="small" muted style={{ flex: 1 }}>
            {p.status === "not_logged_in"
              ? `Not logged in${p.error ? ` (${p.error})` : ""}`
              : `Unavailable${p.error ? `: ${p.error}` : ""}`}
          </Text>
        </View>
      )}
    </View>
  );
}

/** One host: provider usage, then CPU and memory. Registers its refresh so the screen can pull all hosts. */
function HostUsage({ host, register }: { host: Host; register: (id: string, fn: (() => Promise<void>) | undefined) => void }) {
  const conn = useHostConn(host.id);
  const online = conn.status === "online";
  const { usage, refresh } = useUsage(host.id);
  useEffect(() => {
    register(host.id, refresh);
    return () => register(host.id, undefined);
  }, [host.id, refresh, register]);
  const nowS = Math.floor(Date.now() / 1000);
  return (
    <Card style={online ? undefined : { opacity: state.offlineOpacity }}>
      <Text variant="title" numberOfLines={1}>
        {host.name}
      </Text>
      {!online ? (
        <Text variant="small" muted>
          Offline
        </Text>
      ) : usage ? (
        usage.providers.map((p) => <ProviderRows key={p.provider} p={p} nowS={nowS} />)
      ) : (
        <Text variant="small" muted>
          Loading…
        </Text>
      )}
      {online ? <HostMeters hostId={host.id} /> : null}
    </Card>
  );
}

export default function UsageScreen() {
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
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />}>
      {hosts.length === 0 ? (
        <Text muted>No hosts yet. Add one in Settings.</Text>
      ) : (
        hosts.map((h) => <HostUsage key={h.id} host={h} register={register} />)
      )}
    </Screen>
  );
}
