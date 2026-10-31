/** The smoothed round-trip time of a host and the small badge that shows it ("84 ms"). */
import { useEffect, useState } from "react";
import { View } from "react-native";

import type { RpcClient } from "@/rpc/RpcClient";
import { colors, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

/** Above this RTT the badge uses the blocked color. */
export const SLOW_MS = 300;
/** While a terminal is on screen, ping this often so the badge stays current. */
const PING_EVERY_MS = 10_000;

/**
 * The SRTT of `rpc` in ms (undefined before the first sample). While `active`, it pings at once
 * when there is no sample yet, then every 10 s.
 */
export function useSrtt(rpc: RpcClient | undefined, active: boolean): number | undefined {
  const [ms, setMs] = useState(rpc?.srttMs);
  useEffect(() => {
    setMs(rpc?.srttMs);
    if (!rpc) return;
    return rpc.onSrtt(setMs);
  }, [rpc]);
  useEffect(() => {
    if (!rpc || !active) return;
    const ping = () => void rpc.call("ping").catch(() => {});
    if (rpc.srttMs === undefined) ping();
    const timer = setInterval(ping, PING_EVERY_MS);
    return () => clearInterval(timer);
  }, [rpc, active]);
  return ms;
}

/** "84 ms" in a small mono badge. */
export function LatencyBadge({ ms }: { ms: number }) {
  const slow = ms > SLOW_MS;
  return (
    <View
      accessible
      accessibilityLabel={`Latency ${Math.round(ms)} milliseconds`}
      style={{ paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm, backgroundColor: colors.raised }}
    >
      <Text mono variant="small" color={slow ? colors.status.blocked : colors.textMuted}>
        {`${Math.round(ms)} ms`}
      </Text>
    </View>
  );
}
