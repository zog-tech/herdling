import type { RecentSession } from "@herdling/protocol";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronRight, History } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { timeAgo } from "@/hosts/ConnBadge";
import { useHostConn } from "@/hosts/connection";
import { Outcome, Working } from "@/hosts/flowParts";
import { openResumedSession, resumeSession } from "@/herdr/sessionActions";
import { useSnapshots } from "@/herdr/snapshotStore";
import { colors, hitTarget, icon, space, state } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import { Group, Section } from "@/ui/Group";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

const RECENT_LIMIT = 30;

/** Modal: earlier sessions of the agent in its folder, newest first. A pick resumes it in a new tab. */
export default function ResumeScreen() {
  const { hostId, paneId } = useLocalSearchParams<{ hostId: string; paneId: string }>();
  const router = useRouter();
  const { rpc } = useHostConn(hostId);
  const agent = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId));
  const cwd = agent?.cwd;
  const kind = agent?.agent;
  const [sessions, setSessions] = useState<RecentSession[]>();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState<string>();

  useEffect(() => {
    if (!rpc || !cwd || !kind) return;
    let live = true;
    rpc
      .call<RecentSession[]>("sessions.recent", { cwd, kind, limit: RECENT_LIMIT })
      .then((list) => live && setSessions([...list].sort((a, b) => b.last_activity - a.last_activity)))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [rpc, cwd, kind]);

  const pick = useCallback(
    async (s: RecentSession) => {
      if (!rpc || !agent || starting) return;
      setStarting(s.session);
      setError(undefined);
      try {
        const { paneId: next } = await resumeSession(rpc, agent, s.session, hostId);
        openResumedSession(router, hostId, next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStarting(undefined);
      }
    },
    [rpc, agent, starting, router, hostId],
  );

  const note = !rpc
    ? "Computer offline."
    : !agent
      ? "This agent is gone."
      : !cwd
        ? "herdr did not report this agent's folder."
        : sessions?.length === 0
          ? "No earlier sessions in this folder."
          : undefined;

  return (
    <Screen flush>
      {error ? <Outcome ok={false} text={error} /> : null}
      {note ? (
        <StateNotice Icon={History} message={note} />
      ) : !sessions ? (
        error ? null : <Working text="Reading the earlier sessions…" />
      ) : (
        <Section title="Earlier sessions" footer="A pick resumes the session in a new tab.">
          <Group>
            {sessions.map((item) => (
              <Pressable
                key={item.session}
                accessibilityRole="button"
                accessibilityLabel={`Resume: ${item.first_prompt || "untitled session"}, ${timeAgo(item.last_activity)}`}
                accessibilityState={{ disabled: !!starting, busy: starting === item.session }}
                disabled={!!starting}
                onPress={() => pick(item)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  minHeight: hitTarget,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                  backgroundColor: pressed ? colors.raised : "transparent",
                  opacity: starting && starting !== item.session ? state.disabledOpacity : 1,
                })}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={2}>{item.first_prompt || "Untitled session"}</Text>
                  <Text variant="small" muted>
                    {timeAgo(item.last_activity)}
                  </Text>
                </View>
                {starting === item.session ? (
                  <DelayedSpinner color={colors.textMuted} />
                ) : (
                  <ChevronRight size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
                )}
              </Pressable>
            ))}
          </Group>
        </Section>
      )}
    </Screen>
  );
}
