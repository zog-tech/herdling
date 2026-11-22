import type { CommandInfo } from "@herdling/protocol";
import { File } from "expo-file-system";
import { ArrowUp } from "lucide-react-native";
import { memo, useEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, TextInput, useWindowDimensions, View } from "react-native";

import { useSnapshots } from "@/herdr/snapshotStore";
import { useHostConn } from "@/hosts/connection";
import { hasMethod } from "@/hosts/methods";
import type { RpcClient } from "@/rpc/RpcClient";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

import { colors, denseScale, hitTarget, motion, radius, space, state, type } from "@/theme/tokens";
import { GlassSurface } from "@/ui/Glass";
import * as haptics from "@/ui/haptics";
import { sendLine } from "@/terminal/keys";
import { useKeyCommand } from "@/ui/keyCommands";
import { Text } from "@/ui/Text";
import { MicButton } from "@/voice/MicButton";
import { RecordBar } from "@/voice/RecordBar";
import { appendDictation, hostTranscriber } from "@/voice/transcribe";
import { useDictation } from "@/voice/useDictation";
import { DelayedSpinner } from "@/ui/Delayed";

import { addPasteImageListener, hasNativePaste, type PastedImage } from "../../modules/paste";
import {
  clipboardAvailable,
  documentsAvailable,
  fileRoom,
  formatBytes,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_PHOTOS,
  pasteImage,
  photoRoom,
  photosAvailable,
  pickFiles,
  pickPhotos,
  PresenterError,
  uploadErrorText,
  uploadPhotos,
  withPaths,
  type Attachment,
  type Photo,
} from "./attachments";
import { ChoiceMenu } from "./ChoiceMenu";
import { answerChoice, destructiveKey, useChoiceMenu, type Choice } from "./choices";
import { CommandMenu } from "./CommandMenu";
import { CommandSheet } from "./CommandSheet";
import { commandQuery, commandsFor, commandTriggers, filterCommands, useCommands } from "./commands";
import { isFreeform } from "./parseChoices";
import { sendWithPending } from "./pending";
import { PhotoStrip, PlusButton, PlusMenu } from "./PlusMenu";
import { useQuoteInto, withQuote } from "./quote";
import { SavedPromptRow } from "./SavedPromptRow";
import { useSavedPrompts } from "./savedPrompts";
import { usePasteChips } from "./usePasteChips";

const LINE = Math.round(type.size.body * 1.35);
const MAX_LINES = 5;
const SEND_EASE = cubicBezier(...motion.ease.out);
const PAD_V = 10;
/** A button inside the prompt pill. Its touch target is still 44 pt (hitSlop). */
const INNER = 36;
/** Space between the pill edge and its buttons: 44 pt pill = 4 + 36 + 4. */
const INSET = (hitTarget - INNER) / 2;
const INNER_GAP = space.xs;
/** Space between the record bar and the button next to it. */
const BAR_GAP = space.sm;
/** Space between wrapped text and the button row under it. */
const ROW_GAP = space.xs;
/** Most matches the typed `/` menu renders. */
const MENU_MAX = 50;

export const BLOCKED_MESSAGE = "Agent is waiting for a choice — open the terminal";
/** Shown when a prompt send timed out: the host can have sent it, so the user checks before a retry. */
export const UNCONFIRMED_MESSAGE = "No reply from the computer. The prompt can still arrive.";
/** herdlingd 0.2.1 `not_submitted`: the text is in the terminal input, and Enter did not submit it. */
export const NOT_SUBMITTED_MESSAGE = "Not sent: the text is in the terminal input. Tap Retry to press Enter on it, or open the terminal.";
/** Shown after "Type something." was picked: the next send goes into the agent's text field. */
export const FREEFORM_MESSAGE = "Type your answer, then send it to the agent";

/** A free-text answer is one terminal line: Enter in the agent's text field submits it. */
export const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ").trim();

/**
 * Prompt box: multiline, grows to 5 lines, plus voice input; send = herdr `agent.prompt`.
 * Voice input: the mic records and a record bar takes the place of the box. The bar's ✕ discards and
 * its stop button puts the text in the box after its text, for editing. The send button stops,
 * transcribes and sends the prompt at once (the `stopAndSend` event of the hold machine).
 * During a hold the mic stays in the row under the finger: removing it would end the gesture.
 * While the agent is blocked on a numbered menu, buttons answer it (`pane.send_keys` with the digit).
 * After "Type something." the agent shows a text field and stays blocked, so `agent.prompt` fails:
 * the next send types the text into the pane and presses Enter ("free-text mode").
 * The "+" button attaches photos and files (uploaded with `files.put`, their paths go at the end of the prompt)
 * and opens the full list of slash commands. A long press on the box and "Paste" attaches a clipboard image. Typing `/` shows the matching commands.
 * A long text paste becomes a "Pasted text #n" chip (see `pastedText.ts`) and goes as a `.txt` file on send.
 * While the box is empty and has the focus, saved prompts show as chips (see `savedPrompts.ts`).
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
  const [picking, setPicking] = useState(false);
  /**
   * One prompt send or one menu pick at a time, until its call ends. A ref, not state: a tap and
   * ⌘↩ (or two taps) can land before `sending` re-renders, and choice digits must not land inside a prompt.
   */
  const busy = useRef(false);
  const [error, setError] = useState<string | undefined>(initialError);
  /** Bumped after a send: a remount resets the grown multiline height (iOS keeps it otherwise). */
  const [inputKey, setInputKey] = useState(0);
  /** Width of the prompt pill, and the line count of the text at the one-line layout width. */
  const [pillWidth, setPillWidth] = useState(0);
  const [narrowLines, setNarrowLines] = useState(1);
  const lineHeight = Math.round(LINE * inputScale);
  /** Live transcript while the mic is held. */
  const [partial, setPartial] = useState("");
  const latest = useRef(text);
  latest.current = text;
  /**
   * Sets the box text from code (dictation, a quote, a command, a reset). `latest` changes at once,
   * so the paste check in `onChangeText` compares with this text and never makes it a chip.
   */
  const putText = (next: string | ((cur: string) => string)) => {
    const t = typeof next === "function" ? next(latest.current) : next;
    latest.current = t;
    setText(t);
  };
  const online = status === "online" && !!rpc;
  /** Photos and files to attach to the next prompt. */
  const [photos, setPhotos] = useState<Attachment[]>([]);
  /** While attachments upload: how many are done. */
  const [uploaded, setUploaded] = useState<number>();
  const [plusOpen, setPlusOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Bumped when the sheet opens: a new sheet starts with an empty search. */
  const [sheetKey, setSheetKey] = useState(0);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  /** Long pastes, shown as chips. They go as `.txt` files with the next prompt. */
  const pasteChips = usePasteChips({
    // A host without `files.put` cannot take a pasted text file: the paste stays in the box.
    enabled: hasMethod(hello, "files.put"),
    disabled: sending,
    putText,
    focus: () => inputRef.current?.focus(),
  });
  const { pastes } = pasteChips;
  const hostStt =
    rpc && hasMethod(hello, "stt.make")
      ? hostTranscriber(
          (method, params, timeoutMs) => rpc.call(method, params, timeoutMs),
          (uri) => new File(uri).base64(),
        )
      : undefined;
  const dictation = useDictation({
    onText: (t, { send: andSend }) => {
      const next = appendDictation(latest.current, t);
      putText(next);
      if (error) setError(undefined);
      // The send tap gave its haptic already. The text goes explicitly: `text` state is not updated yet.
      if (andSend) void sendPrompt(next, true);
      else inputRef.current?.focus();
    },
    onPartial: setPartial,
    hostStt,
  });
  // "Quote in reply" from a thread row: the quote goes at the end of the draft.
  useQuoteInto(hostId, paneId, (q) => {
    putText((cur) => withQuote(cur, q));
    inputRef.current?.focus();
  });
  const voicePhase = dictation.state.phase;
  /** The record bar takes the place of the "+" button and the prompt box. */
  const voiceActive = voicePhase !== "idle";
  const recordingNow = voicePhase === "recording" || voicePhase === "armedCancel";
  /** A tap-started recording: no finger on the mic, so the mic leaves the row and the bar gets a stop button. */
  const latchedNow = recordingNow && !!dictation.state.latched;
  /** The mic shows at rest and under the finger of a hold. */
  const showMic = visible && (!voiceActive || (recordingNow && !latchedNow));
  /** After a send tap: the text is on its way and goes out when it lands. */
  const voiceSending = voicePhase === "finishing" && !!dictation.state.send;
  /** The send button while the mic records: stop, transcribe and send. */
  const canVoiceSend = recordingNow && online;
  // Terminal mode hides the composer: a recording must not run on behind it.
  const voiceDispatch = dictation.dispatch;
  useEffect(() => {
    if (!visible) voiceDispatch({ type: "cancel", force: true });
  }, [visible, voiceDispatch]);
  // The host went offline: drop the recording, as the mic does while it shows. A failed one stays for a retry.
  useEffect(() => {
    if (!online && dictation.state.phase !== "failed") voiceDispatch({ type: "cancel", force: true });
    // Only a change of `online` cancels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, voiceDispatch]);
  const canSend = online && !sending && !picking && !voiceActive && (text.trim().length > 0 || photos.length > 0 || pastes.length > 0);
  /** The send button is gold when it can send, and while a voice send runs. */
  const gold = canSend || canVoiceSend || voiceSending;
  const hasDraft = text.trim().length > 0 || photos.length > 0 || pastes.length > 0;
  useEffect(() => {
    onDraftChange?.(hasDraft);
  }, [hasDraft, onDraftChange]);
  const blocked = useSnapshots(
    (s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent_status === "blocked",
  );
  const { choices, question, context } = useChoiceMenu(hostId, paneId, blocked && online && visible);
  /**
   * The menu (array from `useChoices`) that was answered or found stale. Its buttons stay hidden;
   * `useChoices` returns a new array only when the screen shows a different menu or the status changes.
   */
  const [answered, setAnswered] = useState<Choice[]>();
  /**
   * Free-text mode: the pane ("host/pane") where "Type something." was picked last. On only for
   * that pane and while its agent stays blocked; it ends after the next send.
   */
  const paneKey = `${hostId}/${paneId}`;
  const [freeformPane, setFreeformPane] = useState<string>();
  const freeform = freeformPane === paneKey && blocked && online;
  useEffect(() => {
    // The agent took the answer, or the menu is gone: the next send is a normal prompt again.
    if (!blocked) setFreeformPane(undefined);
  }, [blocked]);
  const showChoices = blocked && online && !freeform && choices.length > 0 && choices !== answered;
  const agentKind = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent) ?? undefined;
  const typed = commandQuery(text, commandTriggers(agentKind));
  const slash = useCommands(hostId, paneId, visible && online && (typed !== undefined || sheetOpen));
  const matches =
    typed && slash.supported && slash.commands
      ? filterCommands(commandsFor(slash.commands, typed.trigger), typed.query).slice(0, MENU_MAX)
      : [];
  const showMenu = visible && online && !showChoices && matches.length > 0;
  const canAttach = hasMethod(hello, "files.put") && photosAvailable();
  const pasteCount = useRef(0);
  /** Old builds without the native paste hook paste with a row in the "+" menu. */
  const canPasteRow = !hasNativePaste && canAttach && clipboardAvailable() && photoRoom(photos) > 0;
  /** Builds without the document picker (older binaries that got this code over the air) hide "Files". */
  const canAttachFiles = hasMethod(hello, "files.put") && documentsAvailable();
  const showPlus = canAttach || canAttachFiles || slash.supported;
  /** Text padding in the one-line layout: room for "+" on the left, and the mic and send on the right. */
  const leadInset = showPlus ? INSET + INNER + INNER_GAP : space.lg;
  const trailInset = INSET + INNER + (visible ? INNER + INNER_GAP : 0) + INNER_GAP;
  /** The wide layout: the text wraps at the one-line width. Never while the mic records. */
  const expanded = !voiceActive && text.length > 0 && narrowLines >= 2;
  /** True while the prompt box has the keyboard. Only then does an edit menu paste land here. */
  const [focused, setFocused] = useState(false);
  const savedPrompts = useSavedPrompts((s) => s.prompts);
  /** Saved prompt chips: only while the box is empty, has the focus, and nothing else sits above it. */
  const showSaved =
    visible && online && focused && !voiceActive && !showChoices && !showMenu && !plusOpen && text.length === 0 && photos.length === 0 && pastes.length === 0;
  /** Room for more photos, read by the paste listener between renders. */
  const photoCount = useRef(0);
  photoCount.current = MAX_PHOTOS - photoRoom(photos);

  /** Attaches an image pasted from the edit menu of the prompt box. */
  const onPastedImage = (img: PastedImage) => {
    if (!canAttach) {
      setError("This host cannot receive photos.");
      return;
    }
    if (photoCount.current >= MAX_PHOTOS) {
      setError(`You can attach up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const photo: Photo = { uri: `data:image/jpeg;base64,${img.base64}`, name: `pasted-${++pasteCount.current}.jpg`, base64: img.base64 };
    photoCount.current += 1;
    setPhotos((cur) => [...cur, photo].slice(0, MAX_ATTACHMENTS));
    if (error) setError(undefined);
  };
  const onPastedImageRef = useRef(onPastedImage);
  onPastedImageRef.current = onPastedImage;
  // Listen only while the box is focused: the native hook is on only while a listener is,
  // so "Paste" shows for an image in this box and in no other input.
  useEffect(() => {
    if (!focused || !visible || voiceActive) return;
    return addPasteImageListener((img) => onPastedImageRef.current(img));
  }, [focused, visible, voiceActive]);

  /**
   * Answers the menu with the bare digit: Claude's selector confirms on it, so no Enter (nothing lands in the prompt box).
   * A menu with no numbers gets the arrow keys and Enter (`answerKeys`).
   * The screen is re-read first; a menu that changed or is gone gets no keys.
   */
  const pick = async (c: Choice) => {
    if (!rpc || !online || busy.current) return;
    busy.current = true;
    setPicking(true);
    setError(undefined);
    const shown = choices;
    const stillBlocked = () =>
      useSnapshots.getState().byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent_status === "blocked";
    try {
      const r = await answerChoice(rpc, paneId, shown, c, stillBlocked);
      setAnswered(shown);
      if (r === "sent") (c.key === destructiveKey(shown) ? haptics.warn : haptics.commit)();
      // "Type something." opens a text field in the agent: the next send types into it.
      if (r === "sent" && isFreeform(c) && /^Type/i.test(c.label)) setFreeformPane(paneKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      setPicking(false);
    }
  };

  /**
   * Uploads the attached photos, then sends `prompt` with their paths at the end. `fromInput`: it is
   * the typed text, so clear the box after. When an upload fails, nothing is sent. Holds `busy`
   * until the send call ends.
   */
  const sendPrompt = async (prompt: string, fromInput: boolean) => {
    if (!rpc || !online || busy.current) return;
    busy.current = true;
    setSending(true);
    try {
      await sendPromptNow(rpc, prompt, fromInput);
    } finally {
      busy.current = false;
      setSending(false);
    }
  };
  /** The body of `sendPrompt`, under the lock. */
  const sendPromptNow = async (rpc: RpcClient, prompt: string, fromInput: boolean) => {
    setError(undefined);
    setPlusOpen(false);
    const sent = photos;
    const sentPastes = pastes;
    let paths: string[] = [];
    if (sent.length + sentPastes.length > 0) {
      setUploaded(0);
      try {
        paths = await uploadPhotos(rpc, [...sent, ...sentPastes], setUploaded);
      } catch (e) {
        haptics.fail();
        setError(`Upload failed, nothing sent: ${uploadErrorText(e)}`);
        if (!fromInput && !latest.current.trim()) putText(prompt);
        setUploaded(undefined);
        return;
      }
      setUploaded(undefined);
    }
    const full = withPaths(prompt, paths);
    if (sent.length > 0) setPhotos((cur) => cur.filter((p) => !sent.includes(p)));
    pasteChips.sent(sentPastes);
    // The prompt now shows as a pending bubble in the thread, so the box empties at once.
    // Keep anything typed after the tap.
    if (fromInput && latest.current === prompt) {
      putText("");
      // The new box gets no blur event from the old one. autoFocus focuses it again.
      setFocused(false);
      setInputKey((k) => k + 1);
    }
    const stillBlocked =
      useSnapshots.getState().byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent_status === "blocked";
    if (freeform && stillBlocked) {
      // No pending bubble: the answer lands in the agent's tool result, not as a user prompt, so the bubble never clears.
      try {
        await sendLine(rpc, paneId, oneLine(full));
        setFreeformPane(undefined);
      } catch (e) {
        haptics.fail();
        setError(`Not sent: ${e instanceof Error ? e.message : String(e)}`);
        if (fromInput && !latest.current.trim()) putText(prompt);
      }
      return;
    }
    try {
      // No success haptic here: the send already gave its one haptic on the tap.
      await sendWithPending(rpc, hostId, paneId, full);
    } catch (e) {
      haptics.fail();
      const code = (e as { code?: unknown })?.code;
      setError(
        code === "agent_blocked"
          ? BLOCKED_MESSAGE
          : code === "timeout"
            ? UNCONFIRMED_MESSAGE
            : code === "not_submitted"
              ? NOT_SUBMITTED_MESSAGE
              : `Not sent: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  /** A tap on a saved prompt chip: the text goes as it is, with the send haptic. The box keeps its draft. */
  const sendSaved = (t: string) => {
    if (!online || busy.current || voiceActive) return;
    haptics.press();
    void sendPrompt(t, false);
  };
  const pickSaved = (t: string) => {
    putText(t);
    if (error) setError(undefined);
    inputRef.current?.focus();
  };
  const send = () => {
    if (!canSend) return;
    // The one haptic of a send: a light tap at the moment the button dips.
    haptics.press();
    void sendPrompt(text, true);
  };
  // ⌘↩ on a hardware keyboard sends, also while the prompt box has the focus.
  useKeyCommand("send", send, { enabled: visible });

  const attachPhotos = async () => {
    setPlusOpen(false);
    try {
      const picked = await pickPhotos(photoRoom(photos));
      if (picked.length > 0) setPhotos((cur) => [...cur, ...picked].slice(0, MAX_ATTACHMENTS));
    } catch (e) {
      setError(e instanceof PresenterError ? e.message : `Could not open the photo library: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const attachFiles = async () => {
    setPlusOpen(false);
    try {
      const { files, tooLarge } = await pickFiles(fileRoom(photos));
      if (files.length > 0) setPhotos((cur) => [...cur, ...files].slice(0, MAX_ATTACHMENTS));
      if (tooLarge.length > 0) setError(`Too large to attach (max ${formatBytes(MAX_FILE_BYTES)}): ${tooLarge.join(", ")}`);
      else if (error) setError(undefined);
    } catch (e) {
      setError(e instanceof PresenterError ? e.message : `Could not open the files: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  /**
   * Old builds only. Reads the clipboard image (this is the user tap, so the iOS prompt is fine)
   * and attaches it.
   */
  const pasteClipboard = async () => {
    setPlusOpen(false);
    try {
      const photo = await pasteImage(pasteCount.current + 1);
      if (!photo) {
        setError("The clipboard has no image.");
        return;
      }
      pasteCount.current += 1;
      setPhotos((cur) => [...cur, photo].slice(0, MAX_ATTACHMENTS));
    } catch (e) {
      setError(`Could not paste the image: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const openSheet = () => {
    setPlusOpen(false);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  };
  /** Puts `/name ` (or `$name` for a Codex skill, `@name` for an OpenCode skill) in the prompt box. */
  const insertCommand = (c: CommandInfo) => {
    putText(`${c.trigger ?? "/"}${c.name} `);
    if (error) setError(undefined);
  };

  return (
    // No top rule and no fill: the glass prompt box and its buttons float on what is behind (the page, or the glass sheet).
    <View
      style={{
        paddingHorizontal: space.md,
        paddingTop: space.sm,
        paddingBottom: space.sm + bottomInset,
        gap: space.xs,
      }}
    >
      {showChoices ? (
        <ChoiceMenu
          choices={choices}
          question={question}
          context={context}
          agent={agentKind}
          onPick={(c) => void pick(c)}
          onType={() => inputRef.current?.focus()}
          disabled={picking || sending}
        />
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
      ) : freeform ? (
        <Text variant="small" color={colors.status.blocked} accessibilityLiveRegion="polite">
          {FREEFORM_MESSAGE}
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
      {showMenu ? <CommandMenu commands={matches} onPick={insertCommand} /> : null}
      {plusOpen && showPlus && !showMenu ? (
        <PlusMenu
          onPhotos={canAttach && photoRoom(photos) > 0 ? () => void attachPhotos() : undefined}
          onFiles={canAttachFiles && fileRoom(photos) > 0 ? () => void attachFiles() : undefined}
          onPaste={canPasteRow ? () => void pasteClipboard() : undefined}
          onCommands={slash.supported ? openSheet : undefined}
        />
      ) : null}
      {uploaded !== undefined ? (
        <Text variant="small" muted accessibilityLiveRegion="polite">
          Uploading {Math.min(uploaded + 1, photos.length + pastes.length)} of {photos.length + pastes.length}…
        </Text>
      ) : null}
      {photos.length > 0 || pastes.length > 0 ? (
        <PhotoStrip photos={photos} disabled={sending} onRemove={(p) => setPhotos((cur) => cur.filter((x) => x !== p))}>
          {pasteChips.chips}
        </PhotoStrip>
      ) : null}
      {showSaved ? (
        <SavedPromptRow prompts={savedPrompts} canSend={online && !sending && !picking && !voiceActive} onPick={pickSaved} onSend={sendSaved} />
      ) : null}
      {partial ? (
        <Text variant="small" muted numberOfLines={3} accessibilityLabel={`Heard: ${partial}`}>
          {partial}
        </Text>
      ) : null}
      {/*
        The prompt pill: one glass capsule with "+", the text, the mic and send inside. On one line
        the buttons sit at the two ends. When the text wraps, it takes the full width and the buttons
        move to a row under it. The TextInput stays at one place in the tree, so the keyboard stays up.
      */}
      <View onLayout={(e) => setPillWidth(e.nativeEvent.layout.width)}>
      <GlassSurface
        style={{
          minHeight: hitTarget,
          borderRadius: expanded ? radius.lg + space.xs : hitTarget / 2,
          opacity: online ? 1 : state.offlineOpacity,
        }}
      >
        {/* Measures the text at the one-line width: two lines or more opens the wide layout. */}
        {pillWidth > 0 ? (
          <Text
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            maxFontSizeMultiplier={denseScale.row}
            onLayout={(e) => setNarrowLines(Math.round(e.nativeEvent.layout.height / lineHeight))}
            style={{
              position: "absolute",
              opacity: 0,
              width: Math.max(1, pillWidth - leadInset - trailInset),
              fontSize: type.size.body,
              lineHeight: LINE,
            }}
          >
            {`${text} `}
          </Text>
        ) : null}
        <TextInput
          ref={inputRef}
          key={inputKey}
          value={text}
          onChangeText={(t) => {
            putText(pasteChips.change(latest.current, t));
            if (plusOpen) setPlusOpen(false);
            if (error) setError(undefined);
          }}
          editable={online && !voiceActive}
          autoFocus={autoFocus}
          onSelectionChange={pasteChips.onSelectionChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline
          placeholder={online ? "Message the agent" : "Host offline"}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Prompt"
          maxFontSizeMultiplier={denseScale.row}
          style={{
            minHeight: hitTarget,
            maxHeight: voiceActive ? hitTarget : lineHeight * MAX_LINES + PAD_V + (expanded ? ROW_GAP : PAD_V),
            opacity: voiceActive ? 0 : 1,
            color: colors.text,
            fontSize: type.size.body,
            lineHeight: LINE,
            paddingLeft: expanded ? space.lg : leadInset,
            paddingRight: expanded ? space.lg : trailInset,
            paddingTop: PAD_V,
            // Wide layout: the button row is under the text box (not over it), so a scrolled text and
            // the line of the cursor never go under the buttons.
            paddingBottom: expanded ? ROW_GAP : PAD_V,
          }}
        />
        {voiceActive ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              // Room for the send button, and for the held mic during a hold, with a gap before them.
              right: INSET + INNER + (showMic ? INNER + INNER_GAP : 0) + BAR_GAP,
              flexDirection: "row",
            }}
          >
            <RecordBar
              phase={voicePhase}
              onCancel={() => dictation.dispatch({ type: "cancel", force: true })}
              onStop={latchedNow ? () => dictation.dispatch({ type: "toggle" }) : undefined}
              onRetry={() => dictation.dispatch({ type: "retry" })}
              onDiscard={() => dictation.dispatch({ type: "discard" })}
            />
          </View>
        ) : null}
        <View
          pointerEvents="box-none"
          style={{
            ...(expanded
              ? { paddingHorizontal: INSET, paddingBottom: INSET }
              : { position: "absolute" as const, left: INSET, right: INSET, bottom: INSET }),
            flexDirection: "row",
            alignItems: "center",
            gap: INNER_GAP,
          }}
        >
          {showPlus && !voiceActive ? (
            <PlusButton
              bare
              size={INNER}
              open={plusOpen}
              disabled={!online || sending}
              onPress={() => {
                if (!plusOpen) haptics.press();
                setPlusOpen((o) => !o);
              }}
            />
          ) : null}
          <View style={{ flex: 1 }} pointerEvents="none" />
          {showMic ? <MicButton bare dictation={dictation} disabled={!online || sending} size={INNER} hint={false} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !(canSend || canVoiceSend), busy: sending || voiceSending }}
            disabled={!(canSend || canVoiceSend)}
            onPress={canVoiceSend ? () => dictation.dispatch({ type: "stopAndSend" }) : send}
            hitSlop={(hitTarget - INNER) / 2}
            style={{ width: INNER, height: INNER }}
          >
            {({ pressed }) => (
              // Quiet graphite when empty; gold fades in (CSS transition, UI thread) when there is text.
              // A press dips it; Reduce Motion keeps the color change and drops the scale.
              <Animated.View
                style={{
                  flex: 1,
                  borderRadius: INNER / 2,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: gold ? (pressed ? colors.accentPressed : colors.accent) : colors.raised,
                  transform: [{ scale: pressed && !reduced ? motion.send.pressScale : 1 }],
                  transitionProperty: ["backgroundColor", "transform"],
                  transitionDuration: [motion.send.fadeMs, motion.raisedPressMs],
                  transitionTimingFunction: SEND_EASE,
                }}
              >
                {sending || voiceSending ? (
                  <DelayedSpinner color={colors.onAccent} fallback={<ArrowUp size={20} color={colors.onAccent} />} />
                ) : (
                  <ArrowUp size={20} color={gold ? colors.onAccent : colors.textMuted} />
                )}
              </Animated.View>
            )}
          </Pressable>
        </View>
      </GlassSurface>
      </View>
      {pasteChips.viewer}
      {slash.supported ? (
        <CommandSheet
          key={sheetKey}
          visible={sheetOpen}
          commands={slash.commands}
          onClose={() => setSheetOpen(false)}
          onPick={(c) => {
            insertCommand(c);
            setSheetOpen(false);
          }}
          onDismiss={() => inputRef.current?.focus()}
        />
      ) : null}
    </View>
  );
});
