import { useLocalSearchParams, useRouter } from "expo-router";
import { TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { agentLabel } from "@/herdr/agentKinds";
import { restartConfirmed } from "@/herdr/confirmActions";
import { expectPane } from "@/herdr/expectedPanes";
import { canResume, openResumedSession, paneSession } from "@/herdr/sessionActions";
import { useSnapshots } from "@/herdr/snapshotStore";
import { useHostConn } from "@/hosts/connection";
import { DangerWarning, StartOptionsBar } from "@/newSession/StartOptionsBar";
import { buildArgs } from "@/newSession/startOptions";
import { choiceFor, useStartOptionsMemory } from "@/newSession/startOptionsMemory";
import { colors, icon, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { GoldSwitch } from "@/ui/GoldSwitch";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Modal: restart an agent with other start options, for example in Plan mode or with no
 * permission prompts. "Keep the conversation" resumes the same session when the host can.
 * The options are the remembered ones of the agent kind: the same pills and sheet as in New session change them.
 * `replace=1`: opened from the session screen, which the new session replaces.
 */
export default function RestartScreen() {
  const { hostId, paneId, replace } = useLocalSearchParams<{ hostId: string; paneId: string; replace?: string }>();
  const router = useRouter();
  const { rpc, hello } = useHostConn(hostId);
  const agent = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId));
  const kind = agent?.agent ?? undefined;
  const stored = useStartOptionsMemory((s) => s.byKind);
  const choice = kind ? choiceFor(stored, kind) : {};
  const [session, setSession] = useState<string>();
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Ask once for the session of the pane: without one, the restart starts a new conversation.
  useEffect(() => {
    if (!rpc || !kind || !canResume(hello, kind)) return;
    let live = true;
    paneSession(rpc, paneId, kind).then((s) => live && setSession(s));
    return () => {
      live = false;
    };
  }, [rpc, hello, kind, paneId]);

  const opened = useCallback(
    (next: string) => {
      if (replace) {
        openResumedSession(router, hostId, next);
        return;
      }
      expectPane(hostId, next, "agent");
      router.dismiss();
      router.push(`/session/${hostId}/${next}` as never);
    },
    [replace, router, hostId],
  );

  const restart = async () => {
    if (!rpc || !agent || !kind || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await restartConfirmed(rpc, hostId, agent, opened, {
        session: keep ? session : undefined,
        args: buildArgs(kind, choice),
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (!rpc || !agent || !kind)
    return (
      <Screen>
        <Text muted>{!rpc ? "Host offline." : "This agent is gone."}</Text>
      </Screen>
    );

  return (
    <Screen>
      <Text muted>{`${agentLabel(kind)} starts again in a new tab. This pane closes.`}</Text>
      {session ? (
        <Card>
          <Row
            title="Keep the conversation"
            detail={keep ? "The agent resumes this session." : "The agent starts a new conversation."}
            trailing={<GoldSwitch label="Keep the conversation" value={keep} onValueChange={(v) => !busy && setKeep(v)} />}
          />
        </Card>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Text variant="section" accessibilityRole="header">
          Start options
        </Text>
        <StartOptionsBar kind={kind} choice={choice} disabled={busy} />
        <DangerWarning kind={kind} choice={choice} />
      </View>
      {error ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
          <TriangleAlert size={icon.sm} color={colors.danger} strokeWidth={icon.strokeWidth} />
          <Text variant="small" color={colors.danger} style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : null}
      <Button label={busy ? "Restarting…" : "Restart"} loading={busy} onPress={() => void restart()} />
    </Screen>
  );
}
