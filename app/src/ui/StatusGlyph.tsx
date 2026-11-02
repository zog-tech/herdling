import { memo } from "react";
import { View } from "react-native";

import { LanternGlow } from "./LanternGlow";
import { StatusIcon, type BadgeStatus } from "./StatusIcon";

/**
 * The status icon with the lantern glow behind it. Working: the icon turns and the glow breathes.
 * This is the one working indicator of the thread: the Working pill, the subagent cards and the
 * subagent pill use it. Reduce Motion: a static icon and a static glow (from `StatusIcon` and
 * `LanternGlow`). `glow`: light the glow; the default is true while the status is working.
 */
export const StatusGlyph = memo(function StatusGlyph({
  status,
  size,
  glow = status === "working",
}: {
  status: BadgeStatus;
  size: number;
  glow?: boolean;
}) {
  return (
    <View testID={`status-glyph-${status}`} style={{ width: size, height: size }}>
      <LanternGlow active={glow} size={size} />
      <StatusIcon status={status} size={size} />
    </View>
  );
});
