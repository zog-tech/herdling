import { ArrowUp } from "lucide-react-native";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, TextInput, View } from "react-native";

import { useSnapshots } from "@/herdr/snapshotStore";
import { useHostConn } from "@/hosts/connection";
import { hasMethod } from "@/hosts/methods";
import { colors, hitTarget, radius, space, state, type } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { MicButton } from "@/voice/MicButton";
import { DelayedSpinner } from "@/ui/Delayed";

import { MAX_PHOTOS, photosAvailable, pickPhotos, uploadPhotos, withPaths, type Photo } from "./attachments";
import { answerChoice, destructiveKey, useChoices, type Choice } from "./choices";
import { CommandMenu } from "./CommandMenu";
import { CommandSheet } from "./CommandSheet";
import { filterCommands, slashQuery, useCommands } from "./commands";
import { sendWithPending } from "./pending";
import { PermissionButtons } from "./PermissionButtons";
import { PhotoStrip, PlusButton, PlusMenu } from "./PlusMenu";

const LINE = Math.round(type.size.body * 1.35);
const MAX_LINES = 5;
const PAD_V = 10;
/** Most matches the typed `/` menu renders. */
const MENU_MAX = 50;

export const BLOCKED_MESSAGE = "Agent is waiting for a choice — open the terminal";

/**
 * Prompt box: multiline, grows to 5 lines, plus hold-to-talk; send = herdr `agent.prompt`.
 * While the agent is blocked on a numbered menu, buttons answer it (`pane.send_keys` with the digit).
 * The "+" button attaches photos (uploaded with `files.put`, their paths go at the end of the prompt)
 * and opens the full list of slash commands. Typing `/` shows the matching commands.
 */
export function Composer({
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
  const { rpc, status, hello } = useHostConn(hostId);
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
  const canSend = online && !sending && (text.trim().length > 0 || photos.length > 0);
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
  const showPlus = canAttach || slash.supported;

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
      await sendWithPending(rpc, hostId, paneId, full);
      haptics.commit();
    } catch (e) {
      haptics.fail();
      const code = (e as { code?: unknown })?.code;
      setError(code === "agent_blocked" ? BLOCKED_MESSAGE : `Not sent: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const send = () => {
    if (canSend) void sendPrompt(text, true);
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
      {showMenu ? <CommandMenu commands={matches} onPick={(c) => insertCommand(c.name)} /> : null}
      {plusOpen && showPlus && !showMenu ? (
        <PlusMenu
          onPhotos={canAttach && photos.length < MAX_PHOTOS ? () => void attachPhotos() : undefined}
          onCommands={slash.supported ? openSheet : undefined}
        />
      ) : null}
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
        {showPlus ? (
          <PlusButton
            open={plusOpen}
            disabled={!online || sending}
            onPress={() => {
              if (!plusOpen) haptics.press();
              setPlusOpen((o) => !o);
            }}
          />
        ) : null}
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
            borderColor: colors.border,
            borderRadius: radius.lg,
            paddingHorizontal: space.md,
            paddingTop: PAD_V,
            paddingBottom: PAD_V,
            opacity: online ? 1 : state.offlineOpacity,
          }}
        />
        {visible ? (
          <MicButton
            onSend={(t) => void sendPrompt(t, false)}
            onPartial={setPartial}
            disabled={!online || sending}
            size={hitTarget}
          />
        ) : null}
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
            opacity: pressed ? state.pressedFill : 1,
          })}
        >
          {sending ? (
            <DelayedSpinner color={colors.bg} fallback={<ArrowUp size={22} color={colors.bg} />} />
          ) : (
            <ArrowUp size={22} color={canSend ? colors.bg : colors.textMuted} />
          )}
        </Pressable>
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
}
