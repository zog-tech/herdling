import { useIsFocused } from "expo-router";
import {
  ArrowUp,
  Keyboard as KeyboardIcon,
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
import { listsMethod } from "@/hosts/methods";
import { parseAnsi } from "@/terminal/ansi";
import { AnsiText } from "@/terminal/AnsiText";
import {
  ECHO_TIMEOUT_MS,
  lastFilledLine,
  overlayEcho,
  plainText,
  settleEchoes,
  type Echo,
} from "@/terminal/echo";
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
import { sendInput, sendInputWorks } from "@/terminal/keys";
import { LatencyBadge, useSrtt } from "@/terminal/latency";
import {
  endEpoch,
  expire,
  initialPrediction,
  onBackspace,
  onScreen,
  onSrtt,
  onType,
  visiblePrediction,
  type Prediction,
} from "@/terminal/predict";
import { SendQueue, Typist } from "@/terminal/sendQueue";
import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, radius, space, state, type } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";

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

/** How often unconfirmed predictions are checked for the glitch timeout. */
const EXPIRE_TICK_MS = 250;
/**
 * "Type directly" keeps an invisible character in the box, so Backspace on an empty box still
 * changes the text (Android soft keyboards send no key event there). Two values alternate, so
 * a reset always changes the state and React writes it to the native box.
 */
const SENTINEL = "\u200B";
const SENTINEL_2 = "\u200B\u200B";
const resetBuf = (prev: string) => (prev === SENTINEL ? SENTINEL_2 : SENTINEL);

/**
 * Recent pane screen (herdr `pane.read`, ANSI colors), kept scrolled to the end unless the user scrolled up.
 * Follows the screen (`pane.watch`, or a 1 s poll) only while this screen is focused, the view is
 * mounted and the app is active. `controls`: a key row and a text box that type into the pane,
 * a sent line shown at once (local echo), typing prediction in "Type directly" mode, and the latency.
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
  const parsed = useMemo(
    () =>
      text === undefined
        ? undefined
        : parseAnsi(text, colors.ansi).slice(-MAX_LINES),
    [text],
  );
  const { rpc } = useHostConn(hostId);
  const srtt = useSrtt(rpc, focused && !!controls);
  const [echoes, setEchoes] = useState<Echo[]>([]);
  const [predict, setPredict] = useState<Prediction>(initialPrediction);
  const screen = useMemo(() => (parsed ? plainText(parsed) : undefined), [parsed]);
  const lastLine = useMemo(() => (parsed ? lastFilledLine(parsed) : ""), [parsed]);
  useEffect(() => setEchoes((e) => settleEchoes(e, screen, Date.now())), [screen]);
  useEffect(() => {
    if (echoes.length === 0) return;
    const oldest = Math.min(...echoes.map((e) => e.at));
    const t = setTimeout(
      () => setEchoes((e) => settleEchoes(e, screen, Date.now())),
      Math.max(0, oldest + ECHO_TIMEOUT_MS - Date.now()),
    );
    return () => clearTimeout(t);
  }, [echoes, screen]);
  useEffect(() => setPredict((p) => onScreen(p, lastLine, Date.now())), [lastLine]);
  useEffect(() => setPredict((p) => onSrtt(p, srtt)), [srtt]);
  const unconfirmed = predict.typed.length > predict.confirmed;
  useEffect(() => {
    if (!unconfirmed) return;
    const t = setInterval(() => setPredict((p) => expire(p, Date.now())), EXPIRE_TICK_MS);
    return () => clearInterval(t);
  }, [unconfirmed]);
  const shownPrediction = visiblePrediction(predict);
  // The screen plus what the computer did not echo yet. The same array when nothing waits.
  const lines = useMemo(() => {
    if (!parsed) return parsed;
    if (shownPrediction.text) return overlayEcho(parsed, [shownPrediction.text], { underline: shownPrediction.underline });
    return overlayEcho(parsed, echoes.map((e) => e.text));
  }, [parsed, echoes, shownPrediction.text, shownPrediction.underline]);
  const nextEcho = useRef(1);
  const addEcho = useCallback(
    (sent: string) => {
      const id = nextEcho.current++;
      setEchoes((e) => [...e, { id, text: sent, at: Date.now(), base: screen ?? "" }]);
      return id;
    },
    [screen],
  );
  const dropEcho = useCallback((id: number) => setEchoes((e) => e.filter((x) => x.id !== id)), []);
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
        {controls && srtt !== undefined ? (
          <View
            pointerEvents="none"
            style={{ position: "absolute", top: space.sm, right: space.sm + hitTarget + space.xs, height: hitTarget, justifyContent: "center" }}
          >
            <LatencyBadge ms={srtt} />
          </View>
        ) : null}
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
          onEcho={addEcho}
          onEchoFailed={dropEcho}
          setPredict={setPredict}
        />
      ) : null}
    </View>
  );
}

/**
 * Key row plus a one-line box. The box sends its text and Enter in one call (`pane.send_input`).
 * Keys and lines go through an ordered send queue. "Type directly" sends each keystroke at once.
 */
function TerminalControls({
  hostId,
  paneId,
  bottomInset,
  onSent,
  onEcho,
  onEchoFailed,
  setPredict,
}: {
  hostId: string;
  paneId: string;
  bottomInset: number;
  onSent: () => void;
  /** Shows a sent line at once; returns its id. */
  onEcho: (text: string) => number;
  onEchoFailed: (id: number) => void;
  setPredict: (f: (p: Prediction) => Prediction) => void;
}) {
  const { rpc, status, hello } = useHostConn(hostId);
  const online = status === "online" && !!rpc;
  const [line, setLine] = useState("");
  const [error, setError] = useState<string>();
  const [direct, setDirect] = useState(false);
  const [buf, setBuf] = useState(SENTINEL);
  const canSend = online && (direct || line.length > 0);
  // herdlingd with `pane.watch` keeps the order of typing calls, so the queue need not wait.
  const ordered = listsMethod(hello, "pane.watch");
  const queue = useMemo(
    () =>
      rpc
        ? new SendQueue((op) => sendInput(rpc, paneId, op), {
            pipeline: () => ordered && sendInputWorks(rpc),
            onError: (e) => setError(message(e)),
          })
        : undefined,
    [rpc, paneId, ordered],
  );
  useEffect(() => () => queue?.dispose(), [queue]);
  const typist = useMemo(() => (queue ? new Typist(queue) : undefined), [queue]);

  const key = (k: string) => {
    if (!queue || !typist || !online) return;
    setError(undefined);
    setPredict(endEpoch);
    const sent = direct ? typist.key(k) : queue.push({ keys: [k] });
    sent.then(onSent, () => {});
  };

  const send = () => {
    if (!queue || !canSend) return;
    if (direct) {
      key("enter");
      setBuf(resetBuf);
      return;
    }
    const sent = line;
    setLine("");
    setError(undefined);
    const echo = onEcho(sent);
    queue.push({ text: sent, keys: ["enter"] }).then(onSent, () => {
      onEchoFailed(echo);
      // Give the text back, unless the user typed something new.
      setLine((cur) => (cur === "" ? sent : cur));
    });
  };

  /** "Type directly": the change of the box text is the keystrokes since the last change. */
  const typeDirect = (t: string) => {
    if (!typist || !online) return;
    let same = 0;
    while (same < buf.length && same < t.length && buf[same] === t[same]) same++;
    const removed = Array.from(buf.slice(same)).length;
    const added = t.slice(same).replace(/\u200B/g, "");
    if (removed > 0 || added) setError(undefined);
    for (let i = 0; i < removed; i++) {
      void typist.key("backspace");
      setPredict(onBackspace);
    }
    if (added) {
      typist.type(added);
      const now = Date.now();
      setPredict((p) => onType(p, added, now));
    }
    setBuf((prev) => (t.startsWith(SENTINEL) && t.length <= 64 ? t : resetBuf(prev)));
  };

  const toggleDirect = () => {
    haptics.tap();
    typist?.flush();
    setPredict(endEpoch);
    setBuf(resetBuf);
    setDirect((d) => !d);
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
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Type directly"
          accessibilityHint="Sends each key at once, for a hardware keyboard"
          accessibilityState={{ checked: direct }}
          onPress={toggleDirect}
          style={({ pressed }) => ({
            width: hitTarget,
            height: hitTarget,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.raised,
            opacity: pressed ? state.pressedFill : 1,
          })}
        >
          <KeyboardIcon size={20} color={direct ? colors.accent : colors.textMuted} />
        </Pressable>
        <TextInput
          value={direct ? buf : line}
          onChangeText={(t) => {
            if (direct) return typeDirect(t);
            setLine(t);
            if (error) setError(undefined);
          }}
          onSubmitEditing={() => send()}
          submitBehavior="submit"
          returnKeyType="send"
          editable={online}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder={online ? (direct ? "Keys go to the terminal at once" : "Type into the terminal") : "Host offline"}
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
          accessibilityLabel={direct ? "Enter" : "Send line"}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() => send()}
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
          <ArrowUp size={22} color={canSend ? colors.onAccent : colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}
