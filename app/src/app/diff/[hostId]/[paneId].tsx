import type { GitDiff } from "@herdling/protocol";
import { Stack, useLocalSearchParams } from "expo-router";
import { TriangleAlert } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, PixelRatio, Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { DIFF_PAGE_LINES, parseDiff, splitPath, widestLine, type DiffLine } from "@/changes/diff";
import { useHostConn } from "@/hosts/connection";
import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, radius, space, state, textRole, type } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** JetBrains Mono is 0.6 em wide per char. */
const CHAR_EM = 0.6;
const LINE_NO_DIGITS = 5;

/** Font size, line height and char width of the diff text at the user's text size. */
function useMetrics() {
  const scale = Math.min(PixelRatio.getFontScale(), textRole.mono.maxScale);
  const size = textRole.mono.size * scale;
  return { size, line: Math.round(size * type.lineHeight.body), char: size * CHAR_EM, scale };
}

const KIND_WORD: Record<DiffLine["kind"], string> = {
  add: "Added",
  del: "Deleted",
  ctx: "Unchanged",
  hunk: "Section",
  meta: "",
  binary: "",
  note: "",
};

function lineColors(kind: DiffLine["kind"]): { bg: string; fg: string } {
  switch (kind) {
    case "add":
      return { bg: colors.diff.addBg, fg: colors.diff.add };
    case "del":
      return { bg: colors.diff.delBg, fg: colors.diff.del };
    case "hunk":
      return { bg: colors.raised, fg: colors.textMuted };
    case "meta":
    case "note":
    case "binary":
      return { bg: colors.sunken, fg: colors.textMuted };
    default:
      return { bg: colors.sunken, fg: colors.terminal.fg };
  }
}

const Row = memo(function Row({ l, m, numW }: { l: DiffLine; m: ReturnType<typeof useMetrics>; numW: number }) {
  const c = lineColors(l.kind);
  const word = KIND_WORD[l.kind];
  const no = l.kind === "del" ? l.oldNo : l.newNo;
  const body = l.kind === "add" || l.kind === "del" || l.kind === "ctx" ? l.text.slice(1) : l.text;
  const label = word ? `${word}${no != null ? ` line ${no}` : ""}: ${body.trim() || "empty"}` : body;
  const mono = { fontFamily: fontFamily.mono, fontSize: m.size, lineHeight: m.line } as const;
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: "row", height: m.line, backgroundColor: c.bg }}>
      <Text style={[mono, { width: numW, textAlign: "right", color: colors.textMuted }]} allowFontScaling={false} numberOfLines={1}>
        {l.oldNo ?? ""}
      </Text>
      <Text style={[mono, { width: numW, textAlign: "right", color: colors.textMuted }]} allowFontScaling={false} numberOfLines={1}>
        {l.newNo ?? ""}
      </Text>
      <Text style={[mono, { paddingLeft: space.sm, color: c.fg, flexShrink: 0 }]} allowFontScaling={false} numberOfLines={1}>
        {l.text || " "}
      </Text>
    </View>
  );
});

/** Screen: the diff of one changed file. Long lines scroll sideways; a large diff shows in pages. */
export default function DiffScreen() {
  const { hostId, paneId, cwd, path } = useLocalSearchParams<{ hostId: string; paneId: string; cwd?: string; path?: string }>();
  const { rpc } = useHostConn(hostId);
  const [diff, setDiff] = useState<GitDiff>();
  const [error, setError] = useState<string>();
  const [shown, setShown] = useState(DIFF_PAGE_LINES);
  const { width } = useWindowDimensions();
  const m = useMetrics();

  const load = useCallback(async () => {
    if (!rpc) return;
    setError(undefined);
    try {
      setDiff(await rpc.call<GitDiff>("git.diff", { ...(cwd ? { cwd } : { pane_id: paneId }), ...(path ? { path } : {}) }));
    } catch (e) {
      setError(message(e));
    }
  }, [rpc, cwd, paneId, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const lines = useMemo(() => (diff ? parseDiff(diff.diff).flatMap((f) => f.lines) : []), [diff]);
  const page = useMemo(() => lines.slice(0, shown), [lines, shown]);
  const numW = Math.ceil(m.char * LINE_NO_DIGITS);
  // Wide enough for the longest line, so the whole list scrolls sideways as one.
  const contentW = Math.max(width, Math.ceil(numW * 2 + space.sm * 2 + m.char * (widestLine(lines) + 1)));
  const title = path ? splitPath(path)[0] : "Diff";
  const more = lines.length - page.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.sunken }}>
      <Stack.Screen options={{ title }} />
      {error ? (
        <View style={{ paddingHorizontal: space.lg, backgroundColor: colors.card }}>
          <StateNotice Icon={TriangleAlert} color={colors.danger} message={`Can't read the diff: ${error}`} action="Retry" onAction={() => void load()} />
        </View>
      ) : null}
      {path ? (
        <Text variant="caption" muted mono numberOfLines={1} ellipsizeMode="middle" style={{ paddingHorizontal: space.lg, paddingVertical: space.xs, backgroundColor: colors.bg }}>
          {path}
        </Text>
      ) : null}
      {!rpc ? (
        <Centered text="Host offline." />
      ) : !diff ? (
        error ? null : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <DelayedSpinner color={colors.textMuted} />
          </View>
        )
      ) : lines.length === 0 ? (
        <Centered text="No changes in this file." />
      ) : (
        <ScrollView horizontal bounces={false} contentContainerStyle={{ width: contentW }} accessibilityLabel="Diff">
          <FlatList
            data={page}
            style={{ width: contentW }}
            keyExtractor={(_, i) => String(i)}
            getItemLayout={(_, i) => ({ length: m.line, offset: m.line * i, index: i })}
            initialNumToRender={60}
            windowSize={11}
            renderItem={({ item }) => <Row l={item} m={m} numW={numW} />}
            ListFooterComponent={
              <View style={{ width, padding: space.lg, gap: space.sm }}>
                {more > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${Math.min(more, DIFF_PAGE_LINES)} more lines`}
                    onPress={() => setShown((n) => n + DIFF_PAGE_LINES)}
                    style={({ pressed }) => ({
                      minHeight: hitTarget,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.md,
                      backgroundColor: colors.raised,
                      opacity: pressed ? state.pressedFill : 1,
                    })}
                  >
                    <Text bold>{`Show ${Math.min(more, DIFF_PAGE_LINES)} more lines (${more} left)`}</Text>
                  </Pressable>
                ) : null}
                {diff.truncated ? (
                  <Text variant="caption" muted>
                    The diff is too large to show in full. Open the file on the computer to see the rest.
                  </Text>
                ) : null}
              </View>
            }
          />
        </ScrollView>
      )}
    </View>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
      <Text muted style={{ textAlign: "center" }}>
        {text}
      </Text>
    </View>
  );
}
