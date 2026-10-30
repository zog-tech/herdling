import type { RecentSession } from "@zogssh/protocol";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronRight, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { timeAgo } from "@/hosts/ConnBadge";
import { useHostConn } from "@/hosts/connection";
import { openResumedSession, resumeSession } from "@/herdr/sessionActions";
import { useSnapshots } from "@/herdr/snapshotStore";
import { colors, hitTarget, space, state } from "@/theme/tokens";
import { Text } from "@/ui/Text";
import { DelayedSpinner } from "@/ui/Delayed";

const RECENT_LIMIT = 30;

/** Modal: earlier Claude sessions in the agent's folder, newest first. A pick resumes it in a new tab. */
export default function ResumeScreen() {
  const { hostId, paneId } = useLocalSearchParams<{ hostId: string; paneId: string }>();
  const router = useRouter();
  const { rpc } = useHostConn(hostId);
  const agent = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId));
  const cwd = agent?.cwd;
  const [sessions, setSessions] = useState<RecentSession[]>();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState<string>();

  useEffect(() => {
    if (!rpc || !cwd) return;
    let live = true;
    rpc
      .call<RecentSession[]>("sessions.recent", { cwd, limit: RECENT_LIMIT })
      .then((list) => live && setSessions([...list].sort((a, b) => b.last_activity - a.last_activity)))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [rpc, cwd]);

  const pick = useCallback(
    async (s: RecentSession) => {
      if (!rpc || !agent || starting) return;
      setStarting(s.session);
      setError(undefined);
      try {
        const { paneId: next } = await resumeSession(rpc, agent, s.session);
        openResumedSession(router, hostId, next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStarting(undefined);
      }
    },
    [rpc, agent, starting, router, hostId],
  );

  const note = !rpc
    ? "Host offline."
    : !agent
      ? "This agent is gone."
      : !cwd
        ? "herdr did not report this agent's folder."
        : sessions?.length === 0
          ? "No earlier sessions in this folder."
          : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {error ? (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: "row", alignItems: "center", gap: space.xs, padding: space.lg, backgroundColor: colors.card }}
        >
          <TriangleAlert size={16} color={colors.danger} />
          <Text variant="small" color={colors.danger} style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : null}
      {note ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
          <Text muted style={{ textAlign: "center" }}>
            {note}
          </Text>
        </View>
      ) : !sessions ? (
        error ? null : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <DelayedSpinner color={colors.textMuted} />
          </View>
        )
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.session}
          contentContainerStyle={{ paddingVertical: space.sm }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Resume: ${item.first_prompt || "untitled session"}, ${timeAgo(item.last_activity)}`}
              accessibilityState={{ disabled: !!starting, busy: starting === item.session }}
              disabled={!!starting}
              onPress={() => pick(item)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                minHeight: hitTarget + space.lg,
                paddingHorizontal: space.lg,
                paddingVertical: space.sm,
                backgroundColor: pressed ? colors.card : "transparent",
                opacity: starting && starting !== item.session ? state.disabledOpacity : 1,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={2}>{item.first_prompt || "Untitled session"}</Text>
                <Text variant="caption" muted>
                  {timeAgo(item.last_activity)}
                </Text>
              </View>
              {starting === item.session ? (
                <DelayedSpinner color={colors.textMuted} />
              ) : (
                <ChevronRight size={18} color={colors.textMuted} />
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
