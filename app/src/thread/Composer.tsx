import { ArrowUp } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";

import { useHostConn } from "@/hosts/connection";
import { colors, hitTarget, radius, space, type } from "@/theme/tokens";
import { Text } from "@/ui/Text";

const LINE = Math.round(type.size.body * 1.35);
const MAX_LINES = 5;
const PAD_V = 10;

export const BLOCKED_MESSAGE = "Agent is waiting for a choice — open the terminal";

/** Prompt box: multiline, grows to 5 lines; send = herdr `agent.prompt`. */
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
  const latest = useRef(text);
  latest.current = text;
  const online = status === "online" && !!rpc;
  const canSend = online && !sending && text.trim().length > 0;

  const send = async () => {
    if (!rpc || !canSend) return;
    const prompt = text;
    setSending(true);
    setError(undefined);
    try {
      await rpc.call("herdr.call", { method: "agent.prompt", params: { target: paneId, text: prompt } });
      // Keep anything typed while the send was in flight.
      if (latest.current === prompt) {
        setText("");
        setInputKey((k) => k + 1);
      }
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      setError(code === "agent_blocked" ? BLOCKED_MESSAGE : e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
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
      {error ? (
        <Text variant="small" color={colors.status.blocked} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : !online ? (
        <Text variant="small" muted>
          Host offline — you can send when it reconnects.
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
