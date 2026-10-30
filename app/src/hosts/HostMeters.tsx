import { View } from "react-native";

import { useHostStats } from "@/hosts/useHostStats";
import { space } from "@/theme/tokens";
import { formatBytes, pct } from "@/ui/format";
import { Meter } from "@/ui/Meter";

/** CPU and memory meters of one host. Renders nothing until the first reading. */
export function HostMeters({ hostId }: { hostId: string }) {
  const stats = useHostStats(hostId);
  if (!stats) return null;
  return (
    <View style={{ flexDirection: "row", gap: space.lg }}>
      <Meter label="CPU" value={stats.cpu_pct} />
      <Meter
        label="Mem"
        value={pct(stats.mem_used, stats.mem_total)}
        detail={`${formatBytes(stats.mem_used)} / ${formatBytes(stats.mem_total)}`}
      />
    </View>
  );
}
