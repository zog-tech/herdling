import { STATUS_META, type BadgeStatus } from "./StatusIcon";
import { StatusDot } from "./StatusDot";

export type { BadgeStatus } from "./StatusIcon";

export function statusLabel(status: BadgeStatus): string {
  return STATUS_META[status].label;
}

/** A label with a dot in one color, for example "Paired". */
export function Badge({ label, color }: { label: string; color: string }) {
  return <StatusDot label={label} color={color} />;
}

/** Status as dot + word + color, never color alone. Working lights the lantern glow. */
export function StatusBadge({ status }: { status: BadgeStatus }) {
  const { label, color } = STATUS_META[status];
  return <StatusDot label={label} color={color} lit={status === "working"} quiet={status === "offline" || status === "unknown"} />;
}
