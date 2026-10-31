import type { GitChangedFile, GitStatus } from "@herdling/protocol";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronRight, GitBranch, RefreshCw, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { branchLine, fileLabel, splitPath } from "@/changes/diff";
import { useHostConn } from "@/hosts/connection";
import { colors, denseScale, hitTarget, icon, space, state } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The status letter in a fixed-width mono cell. Untracked and conflict files use their own colors. */
function Letter({ status }: { status: string }) {
  const color = status === "D" ? colors.diff.del : status === "A" || status === "?" ? colors.diff.add : status === "U" ? colors.status.blocked : colors.textMuted;
  return (
    <Text mono bold color={color} maxFontSizeMultiplier={denseScale.row} style={{ width: 16, textAlign: "center" }} importantForAccessibility="no">
      {status}
    </Text>
  );
}

function Counts({ file }: { file: GitChangedFile }) {
  if (file.binary)
    return (
      <Text variant="caption" muted maxFontSizeMultiplier={denseScale.row}>
        binary
      </Text>
    );
  if (file.added == null || file.deleted == null) return null;
  return (
    <View style={{ flexDirection: "row", gap: space.xs }} importantForAccessibility="no-hide-descendants">
      <Text mono variant="caption" color={colors.diff.add} maxFontSizeMultiplier={denseScale.row}>{`+${file.added}`}</Text>
      <Text mono variant="caption" color={colors.diff.del} maxFontSizeMultiplier={denseScale.row}>{`−${file.deleted}`}</Text>
    </View>
  );
}

/** Screen: the changed files of the repo the agent works in. A tap opens the diff of the file. */
export default function ChangesScreen() {
  const { hostId, paneId } = useLocalSearchParams<{ hostId: string; paneId: string }>();
  const router = useRouter();
  const { rpc } = useHostConn(hostId);
  const [status, setStatus] = useState<GitStatus>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!rpc) return;
    try {
      const s = await rpc.call<GitStatus>("git.status", { pane_id: paneId });
      setStatus(s);
      setError(undefined);
    } catch (e) {
      setError(message(e));
    }
  }, [rpc, paneId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const open = useCallback(
    (f: GitChangedFile) => {
      if (!status?.root) return;
      router.push({ pathname: "/diff/[hostId]/[paneId]", params: { hostId, paneId, cwd: status.root, path: f.path, status: f.status } } as never);
    },
    [router, status?.root, hostId, paneId],
  );

  const files = status?.files ?? [];
  const header = status?.is_repo ? (
    <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <GitBranch size={icon.sm} color={colors.textMuted} />
        <Text bold numberOfLines={1} style={{ flex: 1 }}>
          {branchLine(status)}
        </Text>
      </View>
      <Text variant="caption" muted>
        {files.length === 0
          ? "No changes."
          : `${files.length}${status.truncated ? "+" : ""} changed ${files.length === 1 ? "file" : "files"}`}
      </Text>
    </View>
  ) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh"
              onPress={() => void refresh()}
              style={({ pressed }) => ({ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center", opacity: pressed ? state.pressedOpacity : 1 })}
            >
              <RefreshCw size={icon.md} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      {error ? (
        <View style={{ paddingHorizontal: space.lg, backgroundColor: colors.card }}>
          <StateNotice Icon={TriangleAlert} color={colors.danger} message={`Can't read the changes: ${error}`} action="Retry" onAction={() => void refresh()} />
        </View>
      ) : null}
      {!rpc ? (
        <Centered text="Host offline." />
      ) : !status ? (
        error ? null : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <DelayedSpinner color={colors.textMuted} />
          </View>
        )
      ) : !status.is_repo ? (
        <Centered text="The agent's folder is not in a git repo." />
      ) : (
        <FlatList
          data={files}
          keyExtractor={(f) => `${f.status}:${f.path}`}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.textMuted} />}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, marginLeft: space.lg + 16 + space.md, backgroundColor: colors.divider }} />}
          contentContainerStyle={{ paddingBottom: space.xxl }}
          renderItem={({ item }) => {
            const [name, dir] = splitPath(item.path);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={fileLabel(item)}
                accessibilityHint="Opens the diff"
                onPress={() => open(item)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  minHeight: hitTarget + space.sm,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm,
                  backgroundColor: pressed ? colors.raised : "transparent",
                })}
              >
                <Letter status={item.status} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text mono numberOfLines={1} ellipsizeMode="middle">
                    {name}
                  </Text>
                  {dir || item.orig_path ? (
                    <Text variant="caption" muted numberOfLines={1} ellipsizeMode="middle">
                      {item.orig_path ? `from ${item.orig_path}` : dir}
                    </Text>
                  ) : null}
                </View>
                <Counts file={item} />
                <ChevronRight size={icon.md} color={colors.textMuted} />
              </Pressable>
            );
          }}
          ListFooterComponent={
            status.truncated ? (
              <Text variant="caption" muted style={{ padding: space.lg }}>
                More files changed than the list shows.
              </Text>
            ) : undefined
          }
        />
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
