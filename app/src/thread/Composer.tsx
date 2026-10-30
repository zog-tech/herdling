import { File } from "expo-file-system";
import { ArrowUp, Check } from "lucide-react-native";
import { memo, useEffect, useRef, useState, type ComponentRef } from "react";
import { AppState, Pressable, TextInput, useWindowDimensions, View } from "react-native";

import { useSnapshots } from "@/herdr/snapshotStore";
import { useHostConn } from "@/hosts/connection";
import { hasMethod } from "@/hosts/methods";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

import { colors, denseScale, hitTarget, motion, radius, space, state, type } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { MicButton } from "@/voice/MicButton";
import { RecordBar } from "@/voice/RecordBar";
import { appendDictation, hostTranscriber } from "@/voice/transcribe";
import { useDictation } from "@/voice/useDictation";
import { DelayedSpinner } from "@/ui/Delayed";

import {
  clipboardHasImage,
  MAX_PHOTOS,
  pasteImage,
  photosAvailable,
  pickPhotos,
  watchClipboard,
  uploadPhotos, withPaths,
  type Photo,
} from "./attachments";
import { answerChoice, destructiveKey, useChoices, type Choice } from "./choices";
import { CommandMenu } from "./CommandMenu";
import { CommandSheet } from "./CommandSheet";
import { filterCommands, slashQuery, useCommands } from "./commands";
import { sendWithPending } from "./pending";
import { PermissionButtons } from "./PermissionButtons";
import { PasteChip, PhotoStrip, PlusButton, PlusMenu } from "./PlusMenu";

const LINE = Math.round(type.size.body * 1.35);
const MAX_LINES = 5;
const SEND_EASE = cubicBezier(...motion.ease.out);
const PAD_V = 10;
/** Most matches the typed `/` menu renders. */
const MENU_MAX = 50;

export const BLOCKED_MESSAGE = "Agent is waiting for a choice — open the terminal";

/**
 * Prompt box: multiline, grows to 5 lines, plus voice input; send = herdr `agent.prompt`.
 * Voice input: the mic records, a record bar takes the place of the box (✕ discards, ✓ stops),
 * and the text lands in the box after its text, for editing. It is not sent.
 * While the agent is blocked on a numbered menu, buttons answer it (`pane.send_keys` with the digit).
 * The "+" button attaches photos (uploaded with `files.put`, their paths go at the end of the prompt)
 * and opens the full list of slash commands. Typing `/` shows the matching commands.
 * Memoized: the session screen re-renders on every thread update, and the props are plain values.
 */
export const Composer = memo(function Composer({
  hostId,
  paneId,
  bottomInset,
  initialText,
  initialError,
  visible = true,
  autoFocus,
  onDraftChange,
}: {
  hostId: string;
  paneId: string;
  bottomInset: number;
  /** False while the screen shows something else (Terminal mode): no menu polling, and the mic is unmounted. */
  visible?: boolean;
  /** Text to start with, for example a first prompt that failed to send. */
  initialText?: string;
  initialError?: string;
  /** Focus the prompt box (and raise the keyboard) on mount. */
  autoFocus?: boolean;
  /** Called when the box gets or loses unsent text or photos (a sheet asks before it closes). */
  onDraftChange?: (hasDraft: boolean) => void;
}) {
  const reduced = useReducedMotion();
  const { rpc, status, hello } = useHostConn(hostId);
  // The box text scales with Dynamic Type up to the row cap. The 5-line limit scales with it.
  const inputScale = Math.min(useWindowDimensions().fontScale, denseScale.row);
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
  /** Photos to attach to the next prompt. */
  const [photos, setPhotos] = useState<Photo[]>([]);
  /** While photos upload: how many are done. */
  const [uploaded, setUploaded] = useState<number>();
  const [plusOpen, setPlusOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Bumped when the sheet opens: a new sheet starts with an empty search. */
  const [sheetKey, setSheetKey] = useState(0);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const hostStt =
    rpc && hasMethod(hello, "stt.make")
      ? hostTranscriber(
          (method, params, timeoutMs) => rpc.call(method, params, timeoutMs),
          (uri) => new File(uri).base64(),
        )
      : undefined;
  const dictation = useDictation({
    onText: (t) => {
      setText((cur) => appendDictation(cur, t));
      if (error) setError(undefined);
      inputRef.current?.focus();
    },
    onPartial: setPartial,
    hostStt,
  });
  const voicePhase = dictation.state.phase;
  /** The record bar takes the place of the "+" button and the prompt box. */
  const voiceActive = voicePhase !== "idle";
  const recordingNow = voicePhase === "recording" || voicePhase === "armedCancel";
  // Terminal mode hides the composer: a recording must not run on behind it.
  const voiceDispatch = dictation.dispatch;
  useEffect(() => {
    if (!visible) voiceDispatch({ type: "cancel", force: true });
  }, [visible, voiceDispatch]);
  const canSend = online && !sending && !voiceActive && (text.trim().length > 0 || photos.length > 0);
  const hasDraft = text.trim().length > 0 || photos.length > 0;
  useEffect(() => {
    onDraftChange?.(hasDraft);
  }, [hasDraft, onDraftChange]);
  const blocked = useSnapshots(
    (s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent_status === "blocked",
  );
  const choices = useChoices(hostId, paneId, blocked && online && visible);
  /**
   * The menu (array from `useChoices`) that was answered or found stale. Its buttons stay hidden;
   * `useChoices` returns a new array only when the screen shows a different menu or the status changes.
   */
  const [answered, setAnswered] = useState<Choice[]>();
  const showChoices = blocked && online && choices.length > 0 && choices !== answered;
  const [picking, setPicking] = useState(false);
  /** Lock against a double tap: two taps can land before `picking` re-renders. */
  const pickLock = useRef(false);
  const query = slashQuery(text);
  const slash = useCommands(hostId, paneId, visible && online && (query !== undefined || sheetOpen));
  const matches =
    query !== undefined && slash.supported && slash.commands ? filterCommands(slash.commands, query).slice(0, MENU_MAX) : [];
  const showMenu = visible && online && !showChoices && matches.length > 0;
  const canAttach = hasMethod(hello, "files.put") && photosAvailable();
  /** True when the clipboard holds an image that the user did not paste yet. */
  const [clipImage, setClipImage] = useState(false);
  /** Set after a paste. The same image stays on the clipboard, so the chip waits for a change. */
  const clipConsumed = useRef(false);
  const pasteCount = useRef(0);
  const canPaste = canAttach && clipImage && photos.length < MAX_PHOTOS;
  const showPlus = canAttach || slash.supported;


  /** Checks the clipboard types only. This does not trigger the iOS paste prompt. */
  const checkClipboard = async () => {
    if (!canAttach) return;
    const has = await clipboardHasImage();
    setClipImage(has && !clipConsumed.current);
  };
  const checkClipboardRef = useRef(checkClipboard);
  checkClipboardRef.current = checkClipboard;
  useEffect(() => {
    if (!canAttach || !visible) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void checkClipboardRef.current();
    });
    const stop = watchClipboard(() => {
      clipConsumed.current = false;
      void checkClipboardRef.current();
    });
    return () => {
      sub.remove();
      stop();
    };
  }, [canAttach, visible]);

  /**
   * Answers the menu with the bare digit: Claude's selector confirms on it, so no Enter (nothing lands in the prompt box).
   * The screen is re-read first; a menu that changed or is gone gets no keys.
   */
  const pick = async (c: Choice) => {
    if (!rpc || !online || pickLock.current) return;
    pickLock.current = true;
    setPicking(true);
    setError(undefined);
    const shown = choices;
    const stillBlocked = () =>
      useSnapshots.getState().byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent_status === "blocked";
    try {
      const r = await answerChoice(rpc, paneId, shown, c, stillBlocked);
      setAnswered(shown);
      if (r === "sent") (c.key === destructiveKey(shown) ? haptics.warn : haptics.commit)();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pickLock.current = false;
      setPicking(false);
    }
  };

  /**
   * Uploads the attached photos, then sends `prompt` with their paths at the end. `fromInput`: it is
   * the typed text, so clear the box after. When an upload fails, nothing is sent.
   */
  const sendPrompt = async (prompt: string, fromInput: boolean) => {
    if (!rpc || !online || sending) return;
    setSending(true);
    setError(undefined);
    setPlusOpen(false);
    const sent = photos;
    let paths: string[] = [];
    if (sent.length > 0) {
      setUploaded(0);
      try {
        paths = await uploadPhotos(rpc, sent, setUploaded);
      } catch (e) {
        haptics.fail();
        setError(`Photo upload failed, nothing sent: ${e instanceof Error ? e.message : String(e)}`);
        if (!fromInput && !latest.current.trim()) setText(prompt);
        setUploaded(undefined);
        setSending(false);
        return;
      }
      setUploaded(undefined);
    }
    const full = withPaths(prompt, paths);
    if (sent.length > 0) setPhotos((cur) => cur.filter((p) => !sent.includes(p)));
    // The prompt now shows as a pending bubble in the thread, so the box empties at once.
    // Keep anything typed after the tap.
    if (fromInput && latest.current === prompt) {
      setText("");
      setInputKey((k) => k + 1);
    }
    setSending(false);
    try {
      // No success haptic here: the send already gave its one haptic on the tap.
      await sendWithPending(rpc, hostId, paneId, full);
    } catch (e) {
      haptics.fail();
      const code = (e as { code?: unknown })?.code;
      setError(code === "agent_blocked" ? BLOCKED_MESSAGE : `Not sent: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const send = () => {
    if (!canSend) return;
    // The one haptic of a send: a light tap at the moment the button dips.
    haptics.press();
    void sendPrompt(text, true);
  };

  const attachPhotos = async () => {
    setPlusOpen(false);
    try {
      const picked = await pickPhotos(MAX_PHOTOS - photos.length);
      if (picked.length > 0) setPhotos((cur) => [...cur, ...picked].slice(0, MAX_PHOTOS));
    } catch (e) {
      setError(`Could not open the photo library: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  /** Reads the clipboard image (this is the user tap, so the iOS prompt is fine) and attaches it. */
  const pasteClipboard = async () => {
    setPlusOpen(false);
    clipConsumed.current = true;
    setClipImage(false);
    try {
      const photo = await pasteImage(++pasteCount.current);
      if (photo) setPhotos((cur) => [...cur, photo].slice(0, MAX_PHOTOS));
    } catch (e) {
      setError(`Could not paste the image: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const openSheet = () => {
    setPlusOpen(false);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  };
  /** Puts `/name ` in the prompt box. */
  const insertCommand = (name: string) => {
    setText(`/${name} `);
    if (error) setError(undefined);
  };

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: colors.divider,
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
      ) : dictation.error ? (
        <Text variant="small" color={colors.status.blocked} accessibilityLiveRegion="polite">
          {dictation.error}
        </Text>
      ) : dictation.caption ? (
        <Text variant="caption" muted accessibilityLiveRegion="polite">
          Transcribed with {dictation.caption}
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
      {showMenu ? <CommandMenu commands={matches} onPick={(c) => insertCommand(c.name)} /> : null}
      {plusOpen && showPlus && !showMenu ? (
        <PlusMenu
          onPhotos={canAttach && photos.length < MAX_PHOTOS ? () => void attachPhotos() : undefined}
          onPaste={canPaste ? () => void pasteClipboard() : undefined}
          onCommands={slash.supported ? openSheet : undefined}
        />
      ) : null}
      {canPaste && !plusOpen ? <PasteChip disabled={sending} onPress={() => void pasteClipboard()} /> : null}
      {uploaded !== undefined ? (
        <Text variant="small" muted accessibilityLiveRegion="polite">
          Uploading photo {Math.min(uploaded + 1, photos.length)} of {photos.length}…
        </Text>
      ) : null}
      {photos.length > 0 ? (
        <PhotoStrip photos={photos} disabled={sending} onRemove={(p) => setPhotos((cur) => cur.filter((x) => x !== p))} />
      ) : null}
      {partial ? (
        <Text variant="small" muted numberOfLines={3} accessibilityLabel={`Heard: ${partial}`}>
          {partial}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
        {voiceActive ? (
          <RecordBar
            phase={voicePhase}
            onCancel={() => dictation.dispatch({ type: "cancel", force: true })}
            onRetry={() => dictation.dispatch({ type: "retry" })}
            onDiscard={() => dictation.dispatch({ type: "discard" })}
          />
        ) : null}
        {!voiceActive && showPlus ? (
          <PlusButton
            open={plusOpen}
            disabled={!online || sending}
            onPress={() => {
              if (!plusOpen) {
                haptics.press();
                void checkClipboard();
              }
              setPlusOpen((o) => !o);
            }}
          />
        ) : null}
        {voiceActive ? null : (
        <TextInput
          ref={inputRef}
          key={inputKey}
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (plusOpen) setPlusOpen(false);
            if (error) setError(undefined);
          }}
          editable={online}
          autoFocus={autoFocus}
          onFocus={() => void checkClipboard()}
          multiline
          placeholder={online ? "Message the agent" : "Host offline"}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Prompt"
          maxFontSizeMultiplier={denseScale.row}
          style={{
            flex: 1,
            minHeight: hitTarget,
            maxHeight: Math.round(LINE * inputScale) * MAX_LINES + PAD_V * 2,
            color: colors.text,
            fontSize: type.size.body,
            lineHeight: LINE,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.lg,
            paddingHorizontal: space.md,
            paddingTop: PAD_V,
            paddingBottom: PAD_V,
            opacity: online ? 1 : state.offlineOpacity,
          }}
        />
        )}
        {visible ? <MicButton dictation={dictation} disabled={!online || sending} size={hitTarget} hint={false} /> : null}
        {recordingNow ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop and transcribe"
            onPress={() => dictation.dispatch({ type: "toggle" })}
            style={({ pressed }) => ({
              width: hitTarget,
              height: hitTarget,
              borderRadius: hitTarget / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? colors.accentPressed : colors.accent,
            })}
          >
            <Check size={22} color={colors.onAccent} />
          </Pressable>
        ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          disabled={!canSend}
          onPress={send}
          style={{ width: hitTarget, height: hitTarget }}
        >
          {({ pressed }) => (
            // Quiet graphite when empty; gold fades in (CSS transition, UI thread) when there is text.
            // A press dips it; Reduce Motion keeps the color change and drops the scale.
            <Animated.View
              style={{
                flex: 1,
                borderRadius: hitTarget / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: canSend ? (pressed ? colors.accentPressed : colors.accent) : colors.raised,
                transform: [{ scale: pressed && !reduced ? motion.send.pressScale : 1 }],
                transitionProperty: ["backgroundColor", "transform"],
                transitionDuration: [motion.send.fadeMs, motion.raisedPressMs],
                transitionTimingFunction: SEND_EASE,
              }}
            >
              {sending ? (
                <DelayedSpinner color={colors.onAccent} fallback={<ArrowUp size={22} color={colors.onAccent} />} />
              ) : (
                <ArrowUp size={22} color={canSend ? colors.onAccent : colors.textMuted} />
              )}
            </Animated.View>
          )}
        </Pressable>
        )}
      </View>
      {slash.supported ? (
        <CommandSheet
          key={sheetKey}
          visible={sheetOpen}
          commands={slash.commands}
          onClose={() => setSheetOpen(false)}
          onPick={(c) => {
            insertCommand(c.name);
            setSheetOpen(false);
          }}
          onDismiss={() => inputRef.current?.focus()}
        />
      ) : null}
    </View>
  );
});
