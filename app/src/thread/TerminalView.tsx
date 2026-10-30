import { useIsFocused } from "expo-router";
import { ArrowUp } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";

import { useHostConn } from "@/hosts/connection";
import { parseAnsi } from "@/terminal/ansi";
import { AnsiText } from "@/terminal/AnsiText";
import { KeyRow } from "@/terminal/KeyRow";
import { sendKey, sendLine } from "@/terminal/keys";
import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, radius, space, state, type } from "@/theme/tokens";
import { Text } from "@/ui/Text";
import { DelayedSpinner } from "@/ui/Delayed";

import { HScrollView } from "./HScrollView";
import { useTerminalText } from "./useTerminalText";

/** Most lines kept on screen; older ones are cut so a long scrollback cannot stall the JS thread. */
const MAX_LINES = 300;
/** Within this many points of the end counts as "at the end": new output scrolls into view. */
const STICK_PX = 40;
const LINE_HEIGHT = 17;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Recent pane screen (herdr `pane.read`, ANSI colors), kept scrolled to the end unless the user scrolled up.
 * Reads every 1 s only while this screen is focused, the view is mounted and the app is active.
 * `controls`: a key row and a text box that type into the pane.
 */
export function TerminalView({
  hostId,
  paneId,
  controls,
  bottomInset = 0,
}: {
  hostId: string;
  paneId: string;
  controls?: boolean;
  bottomInset?: number;
}) {
  const focused = useIsFocused();
  const { text, error, refresh } = useTerminalText(hostId, paneId, focused, { format: "ansi" });
  // Parsed once per new screen: the hook keeps the same string while the screen is unchanged.
  const lines = useMemo(() => (text === undefined ? undefined : parseAnsi(text, colors.ansi).slice(-MAX_LINES)), [text]);
  const scroll = useRef<ScrollViewInstance>(null);
  const atEnd = useRef(true);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atEnd.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - STICK_PX;
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1, backgroundColor: colors.terminal.bg }}
        contentContainerStyle={{ padding: space.md }}
        onScroll={onScroll}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (atEnd.current) scroll.current?.scrollToEnd({ animated: false });
        }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <HScrollView showsHorizontalScrollIndicator={false}>
          {lines ? (
            <AnsiText lines={lines} style={{ fontSize: type.size.caption, lineHeight: LINE_HEIGHT }} />
          ) : (
            <Text mono variant="caption" muted>
              {error ? `Can't read the terminal: ${error}` : "Loading…"}
            </Text>
          )}
        </HScrollView>
      </ScrollView>
      {lines && error ? (
        <Text variant="caption" color={colors.status.blocked} numberOfLines={1} style={{ paddingHorizontal: space.lg }}>
          {`Can't refresh: ${error}`}
        </Text>
      ) : null}
      {controls ? <TerminalControls hostId={hostId} paneId={paneId} bottomInset={bottomInset} onSent={refresh} /> : null}
    </View>
  );
}

/** Key row plus a one-line box: the box sends its text and Enter (`pane.send_text`, `pane.send_keys`). */
function TerminalControls({
  hostId,
  paneId,
  bottomInset,
  onSent,
}: {
  hostId: string;
  paneId: string;
  bottomInset: number;
  onSent: () => void;
}) {
  const { rpc, status } = useHostConn(hostId);
  const online = status === "online" && !!rpc;
  const [line, setLine] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const latest = useRef(line);
  latest.current = line;
  const canSend = online && !sending && line.length > 0;

  const key = (k: string) => {
    if (!rpc || !online) return;
    setError(undefined);
    sendKey(rpc, paneId, k)
      .then(onSent)
      .catch((e) => setError(message(e)));
  };

  const send = async () => {
    if (!rpc || !canSend) return;
    const sent = line;
    setSending(true);
    setError(undefined);
    try {
      await sendLine(rpc, paneId, sent);
      // Keep anything typed while the send was in flight.
      if (latest.current === sent) setLine("");
      onSent();
    } catch (e) {
      setError(message(e));
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
        paddingTop: space.sm,
        paddingBottom: space.sm + bottomInset,
        gap: space.sm,
      }}
    >
      <KeyRow onKey={key} disabled={!online} />
      {error ? (
        <Text variant="small" color={colors.status.blocked} accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.md }}>
          {error}
        </Text>
      ) : !online ? (
        <Text variant="small" muted style={{ paddingHorizontal: space.md }}>
          Host offline — keys work when it reconnects.
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md }}>
        <TextInput
          value={line}
          onChangeText={(t) => {
            setLine(t);
            if (error) setError(undefined);
          }}
          onSubmitEditing={() => void send()}
          submitBehavior="submit"
          returnKeyType="send"
          editable={online}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder={online ? "Type into the terminal" : "Host offline"}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Terminal input"
          style={{
            flex: 1,
            height: hitTarget,
            color: colors.text,
            fontFamily: fontFamily.mono,
            fontSize: type.size.small,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            opacity: online ? 1 : state.offlineOpacity,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send line"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          disabled={!canSend}
          onPress={() => void send()}
          style={({ pressed }) => ({
            width: hitTarget,
            height: hitTarget,
            borderRadius: hitTarget / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canSend ? colors.accent : colors.muted,
            opacity: pressed ? state.pressedFill : 1,
          })}
        >
          {sending ? <DelayedSpinner color={colors.bg} /> : <ArrowUp size={22} color={canSend ? colors.bg : colors.textMuted} />}
        </Pressable>
      </View>
    </View>
  );
}
