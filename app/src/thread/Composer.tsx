import * as Haptics from "expo-haptics";
import { ArrowUp } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";

import { useSnapshots } from "@/herdr/snapshotStore";
import { useHostConn } from "@/hosts/connection";
import { colors, hitTarget, radius, space, type } from "@/theme/tokens";
import { Text } from "@/ui/Text";
import { MicButton } from "@/voice/MicButton";

import { useChoices, type Choice } from "./choices";
import { PermissionButtons } from "./PermissionButtons";

const LINE = Math.round(type.size.body * 1.35);
const MAX_LINES = 5;
const PAD_V = 10;

export const BLOCKED_MESSAGE = "Agent is waiting for a choice — open the terminal";

/**
 * Prompt box: multiline, grows to 5 lines, plus hold-to-talk; send = herdr `agent.prompt`.
 * While the agent is blocked on a numbered menu, buttons answer it (`pane.send_keys` with the digit).
 */
export function Composer({
  hostId,
  paneId,
  bottomInset,
  initialText,
  initialError,
}: {
  hostId: string;
  paneId: string;
  bottomInset: number;
  /** Text to start with, for example a first prompt that failed to send. */
  initialText?: string;
  initialError?: string;
}) {
  const { rpc, status } = useHostConn(hostId);
  const [text, setText] = useState(initialText ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);
  /** Bumped after a send: a remount resets the grown multiline height (iOS keeps it otherwise). */
  const [inputKey, setInputKey] = useState(0);
  /** Live transcript while the mic is held. */
  const [partial, setPartial] = useState("");
  const latest = useRef(text);
  latest.current = text;
  const online = status === "online" && !!rpc;
  const canSend = online && !sending && text.trim().length > 0;
  const blocked = useSnapshots(
    (s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent_status === "blocked",
  );
  const choices = useChoices(hostId, paneId, blocked && online);
  const showChoices = blocked && online && choices.length > 0;
  const [picking, setPicking] = useState(false);

  /** Answers the menu with the bare digit: Claude's selector confirms on it, so no Enter (nothing lands in the prompt box). */
  const pick = async (c: Choice) => {
    if (!rpc || !online || picking) return;
    setPicking(true);
    setError(undefined);
    try {
      await rpc.call("herdr.call", { method: "pane.send_keys", params: { pane_id: paneId, keys: [c.key] } });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(false);
    }
  };

  /** Sends `prompt`. `fromInput`: it is the typed text, so clear the box after. */
  const sendPrompt = async (prompt: string, fromInput: boolean) => {
    if (!rpc || !online || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await rpc.call("herdr.call", { method: "agent.prompt", params: { target: paneId, text: prompt } });
      // Keep anything typed while the send was in flight.
      if (fromInput && latest.current === prompt) {
        setText("");
        setInputKey((k) => k + 1);
      }
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      setError(code === "agent_blocked" ? BLOCKED_MESSAGE : e instanceof Error ? e.message : String(e));
      // A spoken prompt that failed goes into the empty box, ready to resend.
      if (!fromInput && !latest.current.trim()) setText(prompt);
    } finally {
      setSending(false);
    }
  };
  const send = () => {
    if (canSend) void sendPrompt(text, true);
  };

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: colors.muted,
        backgroundColor: colors.bg,
        paddingHorizontal: space.md,
        paddingTop: space.sm,
        paddingBottom: space.sm + bottomInset,
        gap: space.xs,
      }}
    >
      {showChoices ? (
        <PermissionButtons choices={choices} onPick={(c) => void pick(c)} disabled={picking} />
      ) : null}
      {error && !(showChoices && error === BLOCKED_MESSAGE) ? (
        <Text variant="small" color={colors.status.blocked} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : blocked && online && !showChoices ? (
        <Text variant="small" color={colors.status.blocked} accessibilityLiveRegion="polite">
          {BLOCKED_MESSAGE}
        </Text>
      ) : !online ? (
        <Text variant="small" muted>
          Host offline — you can send when it reconnects.
        </Text>
      ) : null}
      {partial ? (
        <Text variant="small" muted numberOfLines={3} accessibilityLabel={`Heard: ${partial}`}>
          {partial}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
        <TextInput
          key={inputKey}
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (error) setError(undefined);
          }}
          editable={online}
          multiline
          placeholder={online ? "Message the agent" : "Host offline"}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Prompt"
          style={{
            flex: 1,
            minHeight: hitTarget,
            maxHeight: LINE * MAX_LINES + PAD_V * 2,
            color: colors.text,
            fontSize: type.size.body,
            lineHeight: LINE,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.muted,
            borderRadius: radius.lg,
            paddingHorizontal: space.md,
            paddingTop: PAD_V,
            paddingBottom: PAD_V,
            opacity: online ? 1 : 0.6,
          }}
        />
        <MicButton onSend={(t) => void sendPrompt(t, false)} onPartial={setPartial} disabled={!online || sending} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          disabled={!canSend}
          onPress={send}
          style={({ pressed }) => ({
            width: hitTarget,
            height: hitTarget,
            borderRadius: hitTarget / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canSend ? colors.accent : colors.muted,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          {sending ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <ArrowUp size={22} color={canSend ? colors.bg : colors.textMuted} />
          )}
        </Pressable>
      </View>
    </View>
  );
}
