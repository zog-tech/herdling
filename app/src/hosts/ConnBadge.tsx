import { Check, Loader } from "lucide-react-native";

import { colors } from "@/theme/tokens";
import { Badge, StatusBadge } from "@/ui/StatusBadge";
import type { HostConn } from "./connection";

/** Connection state of a host: Online, Connecting or Offline. */
export function ConnBadge({ status }: { status: HostConn["status"] }) {
  if (status === "online") return <Badge label="Online" color={colors.status.idle} Icon={Check} />;
  if (status === "connecting") return <Badge label="Connecting" color={colors.status.working} Icon={Loader} />;
  return <StatusBadge status="offline" />;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 30) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
