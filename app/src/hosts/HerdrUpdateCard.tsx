import { ArrowUpCircle } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, View } from "react-native";

import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { DelayedSpinner } from "@/ui/Delayed";
import { Text } from "@/ui/Text";

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
 * The herdr version of a host and the "Update herdr" action, on the host screen. Shows only when
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
    <Card>
      <Text variant="title">herdr</Text>
      {hello ? (
        <Text variant="small" muted>
          {hello.herdr_version ? `Version ${hello.herdr_version}` : "herdr is not running"}
        </Text>
      ) : null}
      {hello && !running ? (
        <Button label="Update herdr" variant="secondary" Icon={ArrowUpCircle} onPress={() => send({ type: "press" })} />
      ) : null}
      {running ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <DelayedSpinner color={colors.textMuted} />
          <Text muted style={{ flex: 1 }}>
            Updating herdr. This can take a few minutes…
          </Text>
        </View>
      ) : null}
      {state.phase === "done" ? (
        <View style={{ gap: space.xs }}>
          <Text color={colors.status.done} accessibilityLiveRegion="polite">
            {state.text}
          </Text>
          {state.output ? (
            <Text variant="caption" mono muted selectable>
              {state.output.split("\n").slice(-OUTPUT_LINES).join("\n")}
            </Text>
          ) : null}
        </View>
      ) : null}
      {state.phase === "failed" ? (
        <Text color={colors.danger} accessibilityLiveRegion="polite" selectable>
          {state.text}
        </Text>
      ) : null}
    </Card>
  );
}
