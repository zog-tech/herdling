import { useRouter } from "expo-router";
import { Check, TriangleAlert } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { allows } from "@/herdr/backend";
import { expectPane } from "@/herdr/expectedPanes";
import { useSnapshots } from "@/herdr/snapshotStore";
import { basename } from "@/herdr/startSession";
import { terminalDetail, terminalFolder, terminalPanes, terminalTitle } from "@/herdr/terminals";
import { useHostConn } from "@/hosts/connection";
import { startBarAtScreenBottom } from "@/newSession/startBar";
import { rememberCommand } from "@/terminal/recentCommands";
import { canWatchShell, NOTIFY_LABEL, watchShell } from "@/terminal/shellWatch";
import { fontFamily } from "@/theme/fonts";
import { colors, denseScale, hitTarget, icon, radius, space, state, type } from "@/theme/tokens";
import { busyProcess, paneFolder, runCommand, useRunRequest, type ProcessInfo, type RunTarget } from "@/thread/runCommand";
import { Button } from "@/ui/Button";
import { useDraftGuard } from "@/ui/draftGuard";
import { GoldSwitch } from "@/ui/GoldSwitch";
import * as haptics from "@/ui/haptics";
import { KeyboardAvoider } from "@/ui/KeyboardAvoider";
import { TerminalMark } from "@/ui/TerminalMark";
import { Text } from "@/ui/Text";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

/** The target key of "New shell". A pane id is never this value. */
const NEW = "\u0000new";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** The folder as the board shows it: "~" for the home folder. */
const shownFolder = (folder: string) => terminalDetail({ hostName: "", folder }, false) ?? folder;

/** One target row: a radio choice with the terminal mark, a title, the folder and a warning line. */
function TargetRow({
  title,
  detail,
  warning,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  detail?: string;
  warning?: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={[title, detail, warning].filter(Boolean).join(", ")}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        if (!selected) haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.edge,
        backgroundColor: selected ? state.selectedFill : pressed ? colors.raised : colors.card,
        opacity: disabled ? state.disabledOpacity : 1,
      })}
    >
      <TerminalMark />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
          {title}
        </Text>
        {detail ? (
          <Text variant="caption" muted mono numberOfLines={1} ellipsizeMode="middle" maxFontSizeMultiplier={denseScale.row}>
            {detail}
          </Text>
        ) : null}
        {warning ? (
          <Text variant="caption" color={colors.status.blocked} numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
            {warning}
          </Text>
        ) : null}
      </View>
      {selected ? <Check size={icon.md} color={colors.accent} strokeWidth={icon.strokeWidth} /> : null}
    </Pressable>
  );
}

/**
 * The run sheet of a shell code block. It is the confirmation: nothing runs before the user taps
 * Run. The command is editable. The target is a new shell in the agent's folder (the default) or an
 * existing terminal on the same host. After the run it opens that terminal. On a host that lists
 * `shell.watch`, "Notify me when it finishes" asks for one push when the command finishes.
 */
export default function RunCommandScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const req = useRunRequest((s) => s.req);
  const hostId = req?.hostId ?? "";
  const { rpc, status, hello } = useHostConn(hostId);
  const online = status === "online" && !!rpc;
  const snapshot = useSnapshots((s) => (hostId ? s.byHost[hostId] : undefined));

  const [command, setCommand] = useState(req?.command ?? "");
  const [target, setTarget] = useState(NEW);
  const [running, setRunning] = useState(false);
  const [notify, setNotify] = useState(false);
  const hostCanNotify = canWatchShell(hello);
  const [error, setError] = useState<string>();
  /** Swipe-down is off while the run is in flight: the sheet must stay until the terminal opens. */
  const allowLeave = useDraftGuard(false, { lock: running });

  const folder = req?.paneId ? paneFolder(snapshot, req.paneId) : undefined;
  const terminals = useMemo(() => (snapshot ? terminalPanes(snapshot) : []), [snapshot]);

  // The busy terminals: a shell whose foreground is another process (an editor, a server).
  const paneIds = terminals.map((p) => p.pane_id).join(",");
  const [busy, setBusy] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!rpc || !online || !paneIds) return;
    let live = true;
    for (const id of paneIds.split(",")) {
      rpc
        .call<ProcessInfo>("herdr.call", { method: "pane.process_info", params: { pane_id: id } })
        .then((r) => {
          const name = busyProcess(r);
          if (live && name) setBusy((b) => ({ ...b, [id]: name }));
        })
        // No answer (an older herdr): the row shows no warning.
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [rpc, online, paneIds]);

  // A terminal that closed, or a folder that is not known, falls back to the next choice.
  const fallback = folder ? NEW : terminals[0]?.pane_id;
  const chosen = target === NEW ? fallback : terminals.some((p) => p.pane_id === target) ? target : fallback;
  const text = command.replace(/\s+$/, "");
  // A Herdr 2 terminal has no "Notify me when it finishes" (`shell.watch` needs herdr 1).
  const canNotify = hostCanNotify && allows(chosen === NEW ? undefined : chosen, "shellWatch");
  const canRun = online && !running && !!text.trim() && chosen !== undefined;

  const run = async () => {
    if (!rpc || !canRun || !req) return;
    haptics.press();
    setError(undefined);
    setRunning(true);
    try {
      const where: RunTarget = chosen === NEW ? { kind: "new", cwd: folder ?? "" } : { kind: "pane", paneId: chosen! };
      const { paneId, commandError } = await runCommand(rpc, snapshot, where, text);
      let watchError: string | undefined;
      if (notify && canNotify && !commandError) await watchShell(rpc, paneId).catch((e: unknown) => (watchError = message(e)));
      if (!commandError) rememberCommand(hostId, text);
      allowLeave();
      // The mark carries the hint into the detail column of regular width too.
      expectPane(hostId, paneId, "shell");
      router.replace({ pathname: "/session/[hostId]/[paneId]", params: { hostId, paneId, shell: "1" } } as never);
      // The shell runs even when the command did not go through: say so over the open terminal.
      if (commandError) Alert.alert("Command not sent", commandError);
      else if (watchError) Alert.alert("No notification", `The command runs, but the computer can't notify you: ${watchError}`);
    } catch (e) {
      haptics.fail();
      setError(`Can't run the command: ${message(e)}`);
      setRunning(false);
    }
  };

  if (!req)
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
        <Text muted>No command to run.</Text>
      </View>
    );

  return (
    <KeyboardAvoider atScreenBottom={startBarAtScreenBottom(Platform.OS, Platform.OS === "ios" && Platform.isPad)} style={{ backgroundColor: colors.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <View style={{ gap: space.sm }}>
          <Text variant="section" accessibilityRole="header" maxFontSizeMultiplier={denseScale.row}>
            Command
          </Text>
          <TextInput
            accessibilityLabel="Command"
            value={command}
            onChangeText={setCommand}
            editable={!running}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            selectionColor={colors.accent}
            style={{
              minHeight: hitTarget * 2,
              maxHeight: hitTarget * 6,
              padding: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.sunken,
              color: colors.text,
              fontFamily: fontFamily.mono,
              fontSize: type.size.small,
              textAlignVertical: "top",
            }}
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="section" accessibilityRole="header" maxFontSizeMultiplier={denseScale.row}>
            Run in
          </Text>
          <TargetRow
            title={folder ? `New shell in ${basename(folder)}` : "New shell"}
            detail={folder ? shownFolder(folder) : "The folder of the agent is not known."}
            selected={chosen === NEW}
            disabled={!folder || running}
            onPress={() => setTarget(NEW)}
          />
          {terminals.map((p) => {
            const f = terminalFolder(p);
            return (
              <TargetRow
                key={p.pane_id}
                title={terminalTitle(p)}
                detail={f ? shownFolder(f) : undefined}
                warning={busy[p.pane_id] ? `Busy: ${busy[p.pane_id]}` : undefined}
                selected={chosen === p.pane_id}
                disabled={running}
                onPress={() => setTarget(p.pane_id)}
              />
            );
          })}
        </View>

        {canNotify ? (
          <View style={{ minHeight: hitTarget, flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text maxFontSizeMultiplier={denseScale.row}>{NOTIFY_LABEL}</Text>
              <Text variant="caption" muted maxFontSizeMultiplier={denseScale.row}>
                A push comes when the shell is free again.
              </Text>
            </View>
            <GoldSwitch label={NOTIFY_LABEL} value={notify} onValueChange={setNotify} />
          </View>
        ) : null}
      </ScrollView>

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.lg), gap: space.sm }}>
        {error || !online ? (
          <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
            <TriangleAlert size={icon.sm} color={error ? colors.danger : colors.textMuted} />
            <Text variant="small" color={error ? colors.danger : colors.textMuted} style={{ flex: 1 }}>
              {error ?? "Host offline. You can run the command when it reconnects."}
            </Text>
          </View>
        ) : null}
        <Button label={running ? "Running…" : "Run"} loading={running} disabled={!canRun} onPress={() => void run()} />
      </View>
    </KeyboardAvoider>
  );
}
