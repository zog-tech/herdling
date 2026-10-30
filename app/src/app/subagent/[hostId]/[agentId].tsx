import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, TriangleAlert } from "lucide-react-native";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHosts } from "@/hosts/store";
import { colors, hitTarget, space } from "@/theme/tokens";
import { ThreadList } from "@/thread/ThreadList";
import { useSubagentThread } from "@/thread/useSubagentThread";
import { Text } from "@/ui/Text";

export default function SubagentScreen() {
  const { hostId, agentId, log, title } = useLocalSearchParams<{ hostId: string; agentId: string; log: string; title?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hostName = useHosts((s) => s.hosts.find((h) => h.id === hostId)?.name ?? hostId);
  const thread = useSubagentThread(hostId, log, agentId);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const { status, items } = thread;

  let body;
  if (items.length === 0) {
    const note =
      status === "loading"
        ? null
        : status === "offline"
          ? "Host offline."
          : status === "error"
            ? `Can't load the subagent thread: ${thread.error ?? "unknown error"}. Retrying…`
            : "No messages yet.";
    body = (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
        {note ? (
          <Text muted style={{ textAlign: "center" }}>
            {note}
          </Text>
        ) : (
          <ActivityIndicator color={colors.textMuted} />
        )}
      </View>
    );
  } else {
    body = (
      <View style={{ flex: 1 }}>
        {status === "error" ? (
          <View
            accessibilityLiveRegion="polite"
            style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.lg, paddingVertical: space.xs, backgroundColor: colors.card }}
          >
            <TriangleAlert size={12} color={colors.status.blocked} />
            <Text variant="caption" color={colors.status.blocked} numberOfLines={1} style={{ flex: 1 }}>
              {`Live updates paused: ${thread.error ?? "unknown error"}. Retrying…`}
            </Text>
          </View>
        ) : null}
        <ThreadList items={items} loadOlder={thread.loadOlder} loadingOlder={thread.loadingOlder} hasOlder={thread.hasOlder} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{ paddingTop: insets.top, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.muted, flexDirection: "row", alignItems: "center", paddingRight: space.lg, gap: space.xs }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={back}
          style={{ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center" }}
        >
          <ChevronLeft size={26} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text bold numberOfLines={1}>
            {title || "Subagent"}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {`${hostName} · subagent`}
          </Text>
        </View>
      </View>
      {body}
    </View>
  );
}
