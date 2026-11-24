import type { CoreInstall, CoreStatus } from "@herdling/protocol";
import { ArrowUpCircle, Download } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";

import { colors, icon } from "@/theme/tokens";
import { Group, Pad, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Text } from "@/ui/Text";

import { getHostConn, useHostConn } from "./connection";
import { Outcome, Working } from "./flowParts";
import {
  CORE_INSTALL_TIMEOUT_MS,
  coreActionLabel,
  coreInstallErrorMessage,
  coreInstallReducer,
  coreInstallText,
  coreStatusLines,
  hasCoreInstall,
  hasCoreStatus,
  initialCoreInstall,
  type CoreInstallEffect,
  type CoreInstallEvent,
  type CoreInstallState,
} from "./coreInstall";

/**
 * The "Herdr 2" (herdr-core) band of the host screen: `core.status` (installed, running and pinned versions,
 * herdr 1), and "Install Herdr 2" or "Update Herdr 2" (`core.install`). Shows only when the host
 * lists `core.status`. The install state machine is in `coreInstall.ts`.
 */
export function CoreCard({ hostId }: { hostId: string }) {
  const conn = useHostConn(hostId);
  const hello = conn.status === "online" ? conn.hello : undefined;
  const shown = hasCoreStatus(hello);
  const [status, setStatus] = useState<CoreStatus>();
  const [statusError, setStatusError] = useState<string>();
  const [state, setState] = useState<CoreInstallState>(initialCoreInstall);
  const current = useRef(state);
  /** Counts status loads; an older answer is dropped. */
  const loads = useRef(0);

  const load = useCallback(() => {
    const rpc = getHostConn(hostId).rpc;
    if (!rpc) return;
    const mine = ++loads.current;
    rpc.call<CoreStatus>("core.status", {}).then(
      (s) => {
        if (mine !== loads.current) return;
        setStatus(s);
        setStatusError(undefined);
      },
      (e: unknown) => mine === loads.current && setStatusError(e instanceof Error ? e.message : String(e)),
    );
  }, [hostId]);

  useEffect(() => {
    if (shown) load();
  }, [shown, load, conn.rpc]);

  const send = (event: CoreInstallEvent) => {
    const r = coreInstallReducer(current.current, event);
    current.current = r.state;
    setState(r.state);
    r.effects.forEach(run);
  };

  const run = (effect: CoreInstallEffect) => {
    const rpc = getHostConn(hostId).rpc;
    if (!rpc) {
      send({ type: "failed", gen: effect.gen, text: "The computer is offline. Connect it first." });
      return;
    }
    rpc.call<CoreInstall>("core.install", {}, CORE_INSTALL_TIMEOUT_MS).then(
      (r) => {
        send({ type: "succeeded", gen: effect.gen, text: coreInstallText(r) });
        load();
      },
      (e: unknown) => {
        send({ type: "failed", gen: effect.gen, text: coreInstallErrorMessage(e) });
        load();
      },
    );
  };

  if (!shown && state.phase !== "running") return null;
  const running = state.phase === "running";
  const action = status && hasCoreInstall(hello) ? coreActionLabel(status) : null;

  return (
    <Section title="Herdr 2">
      <Group>
        <Pad>
          {status ? (
            coreStatusLines(status).map((l) => (
              <Text key={l} variant="small" muted>
                {l}
              </Text>
            ))
          ) : statusError ? (
            <Text variant="small" muted>{`Can't read the Herdr 2 status: ${statusError}`}</Text>
          ) : (
            <Working bare text="Checking Herdr 2…" />
          )}
        </Pad>
        {action && !running ? (
          <Row
            title={action}
            leading={
              status?.found ? (
                <ArrowUpCircle size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
              ) : (
                <Download size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
              )
            }
            onPress={() => send({ type: "press" })}
          />
        ) : null}
        {running ? (
          <Pad>
            <Working bare text="Installing Herdr 2. This can take a few minutes…" />
          </Pad>
        ) : null}
        {state.phase === "done" || state.phase === "failed" ? (
          <Pad>
            <Outcome bare ok={state.phase === "done"} text={state.text} />
          </Pad>
        ) : null}
      </Group>
    </Section>
  );
}
