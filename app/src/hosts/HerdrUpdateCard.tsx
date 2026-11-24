import { ArrowUpCircle } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert } from "react-native";

import { colors, icon } from "@/theme/tokens";
import { Group, Pad, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Text } from "@/ui/Text";

import { Outcome, Working } from "./flowParts";
import { useHostConn } from "./connection";
import {
  canUpdateHerdr,
  CONFIRM_BODY,
  CONFIRM_TITLE,
  initialHerdrUpdate,
  reducer,
  runHerdrUpdate,
  type HerdrUpdateEffect,
  type HerdrUpdateEvent,
  type HerdrUpdateState,
} from "./herdrUpdate";

/** Most lines of the herdr output on the card. The card shows the last lines: they have the outcome. */
const OUTPUT_LINES = 12;

/**
 * The "herdr" band of the host screen: the herdr version and the "Update herdr" action. Shows only when
 * the host lists `herdr.update`. The state machine is in `herdrUpdate.ts`.
 */
export function HerdrUpdateCard({ hostId }: { hostId: string }) {
  const conn = useHostConn(hostId);
  const [state, setState] = useState<HerdrUpdateState>(initialHerdrUpdate);
  // The current state for the event handlers: an alert callback can run after a new render.
  const current = useRef(state);

  const send = (event: HerdrUpdateEvent) => {
    const r = reducer(current.current, event);
    current.current = r.state;
    setState(r.state);
    r.effects.forEach(run);
  };

  const run = (effect: HerdrUpdateEffect) => {
    if (effect.type === "ask") {
      Alert.alert(
        CONFIRM_TITLE,
        CONFIRM_BODY,
        [
          { text: "Cancel", style: "cancel", onPress: () => send({ type: "cancel" }) },
          { text: "Update", style: "destructive", onPress: () => send({ type: "confirm" }) },
        ],
        { cancelable: true, onDismiss: () => send({ type: "cancel" }) },
      );
      return;
    }
    const gen = effect.gen;
    runHerdrUpdate(hostId).then(
      (r) => send({ type: "succeeded", gen, text: r.text, output: r.output }),
      (e: unknown) => send({ type: "failed", gen, text: e instanceof Error ? e.message : "The herdr update failed." }),
    );
  };

  const hello = conn.status === "online" ? conn.hello : undefined;
  const active = state.phase !== "idle" && state.phase !== "confirming";
  if (!canUpdateHerdr(hello) && !active) return null;
  const running = state.phase === "running";

  return (
    <Section title="herdr">
      <Group>
        {hello ? <Row title="Version" trailing={<Text muted>{hello.herdr_version ?? "Not running"}</Text>} /> : null}
        {hello && !running ? (
          <Row
            title="Update herdr"
            leading={<ArrowUpCircle size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
            onPress={() => send({ type: "press" })}
          />
        ) : null}
        {running ? (
          <Pad>
            <Working bare text="Updating herdr. This can take a few minutes…" />
          </Pad>
        ) : null}
        {state.phase === "done" ? (
          <Pad>
            <Outcome bare ok text={state.text} />
            {state.output ? (
              <Text variant="caption" mono muted selectable>
                {state.output.split("\n").slice(-OUTPUT_LINES).join("\n")}
              </Text>
            ) : null}
          </Pad>
        ) : null}
        {state.phase === "failed" ? (
          <Pad>
            <Outcome bare ok={false} text={state.text} />
          </Pad>
        ) : null}
      </Group>
    </Section>
  );
}
