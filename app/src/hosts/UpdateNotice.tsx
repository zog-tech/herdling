import { useRouter } from "expo-router";
import { ArrowUpCircle, X } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { colors, hitTarget, icon, space, state } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { needsHerdlingdUpdate, UPDATE_HERDLINGD_HINT } from "./methods";
import { useHosts, type Host } from "./store";
import { showUpdateNotice, updateStatus } from "./updates";
import type { HostConn } from "./connection";

/**
 * One quiet line under a host on the Overview: "herdlingd X → Y available", which opens the host
 * screen, and a close button that hides it for that version. A herdlingd that misses methods gets
 * the older hint instead.
 */
export function UpdateNotice({ host, conn }: { host: Host; conn: HostConn }) {
  const router = useRouter();
  const hello = conn.status === "online" ? conn.hello : undefined;
  const status = updateStatus(host, hello);
  const open = () => router.push({ pathname: "/hosts/[id]", params: { id: host.id } });
  if (status.kind === "available") {
    if (!showUpdateNotice(host, status)) return null;
    const text = `herdlingd ${status.from} → ${status.to} available`;
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: hitTarget }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${text}. Open ${host.name}`}
          onPress={open}
          style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, opacity: pressed ? state.pressedOpacity : 1 })}
        >
          <ArrowUpCircle size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
          <Text variant="small" muted numberOfLines={1} style={{ flex: 1 }}>
            {text}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Hide the herdlingd ${status.to} notice`}
          hitSlop={4}
          onPress={() => useHosts.getState().updateHost(host.id, { dismissedUpdate: status.to })}
          style={({ pressed }) => ({
            width: hitTarget,
            height: hitTarget,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <X size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
        </Pressable>
      </View>
    );
  }
  if (!hello || !needsHerdlingdUpdate(hello)) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${UPDATE_HERDLINGD_HINT}. Open ${host.name}`} onPress={open}>
      <Text variant="small" muted>
        {UPDATE_HERDLINGD_HINT}
      </Text>
    </Pressable>
  );
}
