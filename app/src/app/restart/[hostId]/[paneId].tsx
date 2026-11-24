import { useLocalSearchParams, useRouter } from "expo-router";
import { CircleAlert, CloudOff, RotateCcw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";

import { agentLabel } from "@/herdr/agentKinds";
import { restartConfirmed } from "@/herdr/confirmActions";
import { expectPane } from "@/herdr/expectedPanes";
import { canResume, openResumedSession, paneSession } from "@/herdr/sessionActions";
import { useSnapshots } from "@/herdr/snapshotStore";
import { useHostConn } from "@/hosts/connection";
import { Lead, Outcome } from "@/hosts/flowParts";
import { StartOptionsBar } from "@/newSession/StartOptionsBar";
import { buildArgs } from "@/newSession/startOptions";
import { choiceFor, useStartOptionsMemory } from "@/newSession/startOptionsMemory";
import { ActionBar } from "@/ui/ActionBar";
import { GoldSwitch } from "@/ui/GoldSwitch";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Modal: restart an agent with other start options, for example in Plan mode or with no
 * permission prompts. "Keep the conversation" resumes the same session when the host can.
 * The options are the remembered ones of the agent kind: the same controls as in New session change them.
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
        <StateNotice Icon={!rpc ? CloudOff : CircleAlert} message={!rpc ? "Computer offline." : "This agent is gone."} />
      </Screen>
    );

  return (
    <Screen
      flush
      footer={<ActionBar primary={{ label: busy ? "Restarting…" : "Restart", Icon: RotateCcw, loading: busy, onPress: () => void restart() }} />}
    >
      <Lead>{`${agentLabel(kind)} starts again in a new tab. This pane closes.`}</Lead>
      {session ? (
        <Section title="Conversation">
          <Group>
            <Row
              title="Keep the conversation"
              detail={keep ? "The agent resumes this session." : "The agent starts a new conversation."}
              trailing={<GoldSwitch label="Keep the conversation" value={keep} onValueChange={(v) => !busy && setKeep(v)} />}
            />
          </Group>
        </Section>
      ) : null}
      <Section title="Start options">
        <StartOptionsBar kind={kind} choice={choice} disabled={busy} />
      </Section>
      {error ? <Outcome ok={false} text={error} /> : null}
    </Screen>
  );
}
