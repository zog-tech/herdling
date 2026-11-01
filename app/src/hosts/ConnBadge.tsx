import { colors } from "@/theme/tokens";
import { StatusDot } from "@/ui/StatusDot";

import type { HostConn } from "./connection";

const CONN: Record<HostConn["status"], { label: string; color: string }> = {
  // Getters: the colors change with the theme.
  online: { label: "Online", get color() { return colors.status.done; } },
  connecting: { label: "Connecting", get color() { return colors.status.working; } },
  offline: { label: "Offline", get color() { return colors.textMuted; } },
};

/** Connection state of a host as a dot and a word: Online, Connecting or Offline. */
export function ConnStatus({ status }: { status: HostConn["status"] }) {
  const { label, color } = CONN[status];
  return <StatusDot label={label} color={color} quiet={status === "offline"} />;
}

/** The label of a connection state, for a row's accessibility label. */
export const connLabel = (status: HostConn["status"]) => CONN[status].label;

/**
 * The plain line under a host in a list: where it is (`user@address`, the port when not 22) and,
 * when it is not online, when it was last seen.
 */
export function hostDetail(
  host: { user: string; address: string; port: number },
  status: HostConn["status"],
  lastSeen?: number,
  now = Date.now(),
): string {
  const where = `${host.user}@${host.address}${host.port === 22 ? "" : `:${host.port}`}`;
  return status === "online" || !lastSeen ? where : `${where} · seen ${timeAgo(lastSeen, now)}`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 30) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
