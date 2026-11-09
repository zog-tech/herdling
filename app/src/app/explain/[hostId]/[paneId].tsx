import { useLocalSearchParams, useRouter } from "expo-router";
import { CircleAlert, CloudOff, Puzzle, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { explainAgent, explainView, type ExplainView } from "@/herdr/explain";
import { LIST_METHOD, listIntegrations, needsIntegration, type IntegrationInfo } from "@/herdr/integrations";
import { useSnapshots } from "@/herdr/snapshotStore";
import { herdrSupports, UNSUPPORTED } from "@/herdr/support";
import { useHostConn } from "@/hosts/connection";
import { RpcError } from "@/rpc/RpcClient";
import { colors, icon, radius, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { DelayedSpinner } from "@/ui/Delayed";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

type State =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
  | { kind: "ready"; view: ExplainView; integration?: IntegrationInfo };

/**
 * Modal: why herdr shows this status for the agent (`agent.explain`). Plain text and fields only.
 * When herdr is not sure and the agent kind has no current integration, it offers the
 * integrations screen.
 */
export default function ExplainScreen() {
  const { hostId, paneId } = useLocalSearchParams<{ hostId: string; paneId: string }>();
  const router = useRouter();
  const { rpc } = useHostConn(hostId);
  const kind = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent);
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(
    async (live: () => boolean = () => true) => {
      if (!rpc) return;
      setState({ kind: "loading" });
      try {
        const view = explainView(await explainAgent(rpc, hostId, paneId));
        let integration: IntegrationInfo | undefined;
        if (view.uncertain && herdrSupports(hostId, LIST_METHOD)) {
          integration = needsIntegration(await listIntegrations(rpc, hostId).catch(() => []), kind);
        }
        if (live()) setState({ kind: "ready", view, integration });
      } catch (e) {
        if (!live()) return;
        if (e instanceof RpcError && e.code === UNSUPPORTED) setState({ kind: "unsupported" });
        else setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [rpc, hostId, paneId, kind],
  );

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load]);

  if (!rpc)
    return (
      <Screen>
        <StateNotice Icon={CloudOff} message="The computer is offline. Connect it to see the explanation." />
      </Screen>
    );
  if (state.kind === "loading")
    return (
      <Screen>
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <DelayedSpinner color={colors.textMuted} />
          <Text muted>Asking herdr…</Text>
        </View>
      </Screen>
    );
  if (state.kind === "unsupported")
    return (
      <Screen>
        <StateNotice
          Icon={CircleAlert}
          message="The herdr on this computer cannot explain a status. Update herdr on the computer to use this."
        />
      </Screen>
    );
  if (state.kind === "error")
    return (
      <Screen>
        <StateNotice
          Icon={CircleAlert}
          color={colors.danger}
          message={`Can't get the explanation: ${state.message}`}
          action="Retry"
          onAction={() => void load()}
        />
      </Screen>
    );

  const { view, integration } = state;
  return (
    <Screen flush>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }} accessibilityLiveRegion="polite">
        <Text variant="headline">{view.summary}</Text>
        {view.reasons.map((r) => (
          <Text key={r} variant="small" muted selectable>
            {r}
          </Text>
        ))}
      </View>

      {integration ? (
        <Section title="Exact status">
          <Group>
            <Row
              leading={<Puzzle size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
              title={`Install the ${integration.label} integration`}
              detail="With the integration, the agent tells herdr its status. herdr then does not guess from the screen."
              chevron
              onPress={() => router.push({ pathname: "/hosts/integrations", params: { id: hostId } })}
            />
          </Group>
        </Section>
      ) : null}

      <Section title="Details">
        <Group>
          {view.fields.map((f) => (
            <Row key={f.label} title={f.label}>
              <Text variant="small" muted mono={f.mono} selectable>
                {f.value}
              </Text>
            </Row>
          ))}
        </Group>
      </Section>

      {view.evidence ? (
        <Section title="Screen text of the rule">
          <View style={{ marginHorizontal: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: colors.sunken }}>
            <Text variant="caption" mono selectable>
              {view.evidence}
            </Text>
          </View>
        </Section>
      ) : null}

      {view.matched.length > 1 ? (
        <Section title="Rules that matched" footer="The rule with the highest priority sets the status.">
          <Group>
            {view.matched.map((m) => (
              <Row key={m.id}>
                <Text mono>{m.id}</Text>
                <Text variant="small" muted>
                  {m.detail}
                </Text>
              </Row>
            ))}
          </Group>
        </Section>
      ) : null}

      <View style={{ paddingHorizontal: space.lg }}>
        <Button label="Check again" variant="secondary" Icon={RefreshCw} onPress={() => void load()} />
      </View>
    </Screen>
  );
}
