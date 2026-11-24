import { Stack, useLocalSearchParams } from "expo-router";
import { CircleAlert, CloudOff, RefreshCw } from "lucide-react-native";
import { Alert } from "react-native";

import { actionLabel, groupIntegrations, installConfirm, stateLabel, type IntegrationInfo } from "@/herdr/integrations";
import { useIntegrations, type InstallResult } from "@/herdr/useIntegrations";
import { Lead, Working } from "@/hosts/flowParts";
import { IconButton } from "@/ui/IconButton";
import { useHosts } from "@/hosts/store";
import { colors } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Group, Section } from "@/ui/Group";
import * as haptics from "@/ui/haptics";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

/**
 * The herdr agent integrations of one computer (`integration.list`), with Install or Update for
 * each one that is missing or old (`integration.install`). An install asks first, because it
 * changes the configuration of the agent on the computer.
 */
export default function IntegrationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const hostName = useHosts((s) => s.hosts.find((h) => h.id === id)?.name ?? id);
  const { state, busy, results, install, reload } = useIntegrations(id);

  const confirm = (i: IntegrationInfo) => {
    const c = installConfirm(i, hostName);
    haptics.warn();
    Alert.alert(c.title, c.message, [
      { text: "Cancel", style: "cancel" },
      { text: c.action, onPress: () => void install(i.target) },
    ]);
  };

  // Refresh is a header button, so no button floats at the end of the list.
  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <IconButton label="Refresh" Icon={RefreshCw} disabled={!!busy || state.kind === "loading"} onPress={() => void reload()} size="header" />
        ),
      }}
    />
  );

  if (state.kind !== "ready")
    return (
      <Screen>
        {header}
        {state.kind === "loading" ? (
          <Working bare text="Reading the integrations…" />
        ) : state.kind === "offline" ? (
          <StateNotice Icon={CloudOff} message={`${hostName} is offline. Connect it to see its integrations.`} />
        ) : state.kind === "unsupported" ? (
          <StateNotice
            Icon={CircleAlert}
            message={`The herdr on ${hostName} cannot list its integrations. Update herdr on the computer to use this screen.`}
          />
        ) : (
          <StateNotice
            Icon={CircleAlert}
            color={colors.danger}
            message={`Can't read the integrations: ${state.message}`}
            action="Retry"
            onAction={() => void reload()}
          />
        )}
      </Screen>
    );

  const groups = groupIntegrations(state.list);
  const row = (i: IntegrationInfo) => {
    const action = actionLabel(i);
    const canAct = action && (i.available || i.state === "outdated");
    return (
      <Row
        key={i.target}
        title={i.label}
        detail={stateLabel(i)}
        accessibilityLabel={`${i.label}, ${stateLabel(i)}`}
        trailing={
          canAct ? (
            <Button
              label={action}
              variant="secondary"
              loading={busy === i.target}
              disabled={!!busy && busy !== i.target}
              onPress={() => confirm(i)}
            />
          ) : undefined
        }
        below={<ResultLine result={results[i.target]} />}
      />
    );
  };

  return (
    <Screen flush>
      {header}
      <Lead>
        An integration lets an agent tell herdr its status. Without one, herdr reads the screen of the agent, and the
        status can be wrong or unknown.
      </Lead>
      {groups.missing.length > 0 ? (
        <Section title="Not installed" footer="An install changes the configuration of the agent on the computer. Herdling asks before each install.">
          <Group>{groups.missing.map(row)}</Group>
        </Section>
      ) : null}
      {groups.installed.length > 0 ? (
        <Section title="Installed">
          <Group>{groups.installed.map(row)}</Group>
        </Section>
      ) : null}
      {groups.absent.length > 0 ? (
        <Section title="Agent not found" footer={`herdr does not find these agents on ${hostName}. Install the agent first.`}>
          <Group>{groups.absent.map(row)}</Group>
        </Section>
      ) : null}
    </Screen>
  );
}

/** The result of the last install of one row: herdr's lines, or the error. */
function ResultLine({ result }: { result?: InstallResult }) {
  if (!result) return null;
  if (!result.ok)
    return (
      <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
        {`The install failed: ${result.message}`}
      </Text>
    );
  return (
    <Text variant="small" color={colors.status.done} accessibilityLiveRegion="polite">
      {result.messages.length > 0 ? result.messages.join("\n") : "The integration is installed."}
    </Text>
  );
}
