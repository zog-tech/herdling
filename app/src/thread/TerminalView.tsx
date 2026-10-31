import { useIsFocused } from "expo-router";
import {
  ArrowUp,
  Maximize2,
  WrapText,
  MoveHorizontal,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";

import { useHostConn } from "@/hosts/connection";
import { parseAnsi } from "@/terminal/ansi";
import { AnsiText } from "@/terminal/AnsiText";
import {
  FIT_MIN_SIZE,
  fitFontSize,
  lineHeightFor,
  nextWidthMode,
  widestCols,
  type WidthMode,
} from "@/terminal/fit";
import { KeyRow } from "@/terminal/KeyRow";
import { findInLines, markLines } from "@/terminal/search";
import { useTerminalWidth } from "@/terminal/widthMode";
import { sendKey, sendLine } from "@/terminal/keys";
import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, radius, space, state, type } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { DelayedSpinner } from "@/ui/Delayed";

import { HScrollView } from "./HScrollView";
import { useTerminalText } from "./useTerminalText";

/** Most lines kept on screen; older ones are cut so a long scrollback cannot stall the JS thread. */
const MAX_LINES = 300;
/** Within this many points of the end counts as "at the end": new output scrolls into view. */
const STICK_PX = 40;
const LINE_HEIGHT = lineHeightFor(type.size.caption);

const MODES: Record<WidthMode, { label: string; Icon: typeof Maximize2 }> = {
  fit: { label: "Fit to screen", Icon: Maximize2 },
  wrap: { label: "Wrap lines", Icon: WrapText },
  scroll: { label: "Scroll sideways", Icon: MoveHorizontal },
};

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
  search,
}: {
  hostId: string;
  paneId: string;
  controls?: boolean;
  bottomInset?: number;
  /**
   * Search in the visible text. `index`: the current match, top to bottom; -1 or out of range means
   * the last one. `onCount` gets the number of matches after each change.
   */
  search?: { term: string; index: number; onCount: (n: number) => void };
}) {
  const focused = useIsFocused();
  const { text, error, refresh } = useTerminalText(hostId, paneId, focused, {
    format: "ansi",
  });
  // Parsed once per new screen: the hook keeps the same string while the screen is unchanged.
  const lines = useMemo(
    () =>
      text === undefined
        ? undefined
        : parseAnsi(text, colors.ansi).slice(-MAX_LINES),
    [text],
  );
  const scroll = useRef<ScrollViewInstance>(null);
  const atEnd = useRef(true);
  const viewHeight = useRef(0);
  const term = search?.term ?? "";
  const matches = useMemo(() => (lines && term.trim() ? findInLines(lines, term) : []), [lines, term]);
  const current = matches.length === 0 ? -1 : search && search.index >= 0 && search.index < matches.length ? search.index : matches.length - 1;
  const shown = useMemo(
    () =>
      lines && matches.length > 0
        ? markLines(lines, matches, current, {
            current: { fg: colors.search.currentFg, bg: colors.search.currentBg },
            other: { fg: colors.search.matchFg, bg: colors.search.matchBg },
          })
        : lines,
    [lines, matches, current],
  );
  const onCount = search?.onCount;
  useEffect(() => {
    onCount?.(matches.length);
  }, [onCount, matches.length]);
  const mode = useTerminalWidth((s) => s.mode);
  const setMode = useTerminalWidth((s) => s.set);
  const [viewWidth, setViewWidth] = useState(0);
  const cols = useMemo(() => (lines ? widestCols(lines) : 0), [lines]);
  // Depends on the column count and the view width only, so it does not jump on small refreshes.
  const fontSize =
    mode === "fit"
      ? fitFontSize(cols, viewWidth - 2 * space.md, type.size.caption)
      : type.size.caption;
  const lineHeight = mode === "fit" ? lineHeightFor(fontSize) : LINE_HEIGHT;
  // Keep the current match in the middle of the view: on a new query, a step, or when new output
  // moves its line. With wrapped lines the place is close, not exact.
  const currentLine = current >= 0 ? matches[current]?.line : undefined;
  useEffect(() => {
    if (currentLine === undefined) return;
    atEnd.current = false;
    const y = space.md + currentLine * lineHeight - viewHeight.current / 2;
    scroll.current?.scrollTo({ y: Math.max(0, y), animated: true });
  }, [currentLine, lineHeight]);
  // The search ends: back to the latest output.
  const searched = useRef(false);
  useEffect(() => {
    if (term.trim()) searched.current = true;
    else if (searched.current) {
      searched.current = false;
      atEnd.current = true;
      scroll.current?.scrollToEnd({ animated: false });
    }
  }, [term]);
  const toEnd = useCallback(() => {
    atEnd.current = true;
    scroll.current?.scrollToEnd({ animated: false });
  }, []);
  const termRef = useRef(term);
  termRef.current = term;
  // The keyboard opens: keep the latest output in view, even after the user scrolled up.
  // Not while a search shows a match (the search box opens the keyboard too).
  useEffect(() => {
    if (!controls) return;
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (!termRef.current.trim()) toEnd();
    });
    return () => sub.remove();
  }, [controls, toEnd]);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setViewWidth(e.nativeEvent.layout.width);
    viewHeight.current = e.nativeEvent.layout.height;
    // The view got shorter (keyboard): stay at the end.
    if (atEnd.current) scroll.current?.scrollToEnd({ animated: false });
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atEnd.current =
      contentOffset.y + layoutMeasurement.height >=
      contentSize.height - STICK_PX;
  }, []);

  const body = shown ? (
    <AnsiText lines={shown} style={{ fontSize, lineHeight }} />
  ) : (
    <Text mono variant="caption" muted>
      {error ? `Can't read the terminal: ${error}` : "Loading…"}
    </Text>
  );
  const { label, Icon } = MODES[mode];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scroll}
          onLayout={onLayout}
          style={{ flex: 1, backgroundColor: colors.terminal.bg }}
          contentContainerStyle={{ padding: space.md }}
          onScroll={onScroll}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            // While a search shows a match, new output does not pull the view to the end.
            if (atEnd.current && !term.trim()) scroll.current?.scrollToEnd({ animated: false });
          }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          {mode === "wrap" ? (
            body
          ) : (
            <HScrollView showsHorizontalScrollIndicator={false}>
              {body}
            </HScrollView>
          )}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Terminal width: ${label}`}
          accessibilityHint="Double tap to change how the terminal text fits the screen"
          onPress={() => {
            haptics.tap();
            setMode(nextWidthMode(mode));
          }}
          style={({ pressed }) => ({
            position: "absolute",
            top: space.sm,
            right: space.sm,
            width: hitTarget,
            height: hitTarget,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.raised,
            opacity: pressed ? state.pressedFill : 0.8,
          })}
        >
          <Icon size={18} color={colors.textMuted} />
        </Pressable>
      </View>
      {lines && error ? (
        <Text
          variant="caption"
          color={colors.status.blocked}
          numberOfLines={1}
          style={{ paddingHorizontal: space.lg }}
        >
          {`Can't refresh: ${error}`}
        </Text>
      ) : null}
      {controls ? (
        <TerminalControls
          hostId={hostId}
          paneId={paneId}
          bottomInset={bottomInset}
          onSent={refresh}
        />
      ) : null}
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
        borderTopColor: colors.divider,
        backgroundColor: colors.bg,
        paddingTop: space.sm,
        paddingBottom: space.sm + bottomInset,
        gap: space.sm,
      }}
    >
      <KeyRow onKey={key} disabled={!online} />
      {error ? (
        <Text
          variant="small"
          color={colors.status.blocked}
          accessibilityLiveRegion="polite"
          style={{ paddingHorizontal: space.md }}
        >
          {error}
        </Text>
      ) : !online ? (
        <Text variant="small" muted style={{ paddingHorizontal: space.md }}>
          Host offline — keys work when it reconnects.
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
        }}
      >
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
            backgroundColor: canSend ? colors.accent : colors.raised,
            opacity: pressed ? state.pressedFill : 1,
          })}
        >
          {sending ? (
            <DelayedSpinner color={colors.onAccent} />
          ) : (
            <ArrowUp
              size={22}
              color={canSend ? colors.onAccent : colors.textMuted}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}
