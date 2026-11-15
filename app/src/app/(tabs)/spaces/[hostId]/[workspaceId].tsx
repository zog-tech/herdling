/**
 * One space: the tabs as chips, the panes of the selected tab as live thumbnails, and the space
 * actions ("+ Terminal", "New agent" and "…"). Only the thumbnails of the selected tab read their
 * screens, slowly, and only while the screen shows (`useThumbnails`).
 */
import { useIsFocused, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Bot, Ellipsis, LayoutGrid, Plus } from "lucide-react-native";
import { useLayoutEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { allows, renameKindsFor } from "@/herdr/backend";
import { expectPane } from "@/herdr/expectedPanes";
import { promptRename, renameSupported } from "@/herdr/rename";
import { useSnapshots } from "@/herdr/snapshotStore";
import { startShell } from "@/herdr/startSession";
import { getHostConn, useHostConn } from "@/hosts/connection";
import { firstTab, hostSpaces, MAX_THUMBS, tabLabel } from "@/spaces/spaces";
import { PaneThumb } from "@/spaces/PaneThumb";
import { useThumbnails } from "@/spaces/useThumbnails";
import { colors, denseScale, dot, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import * as haptics from "@/ui/haptics";
import { showActionSheet } from "@/ui/nativeSheet";
import { StateNotice } from "@/ui/StateNotice";
import { layoutClass } from "@/ui/layout";
import { Text } from "@/ui/Text";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

/** A tab chip: gold when selected, with an ember dot when a pane of the tab needs you. */
function TabChip({ label, selected, attention, onPress }: { label: string; selected: boolean; attention: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={attention ? `${label}, needs you` : label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs + 2,
        minHeight: hitTarget - space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.divider,
        backgroundColor: selected ? colors.accentTint : colors.card,
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      <Text variant="small" bold={selected} color={selected ? colors.accent : colors.text} maxFontSizeMultiplier={denseScale.pill}>
        {label}
      </Text>
      {attention ? <View style={{ width: dot.size, height: dot.size, borderRadius: dot.size / 2, backgroundColor: colors.status.blocked }} /> : null}
    </Pressable>
  );
}

export default function SpaceScreen() {
  const { hostId, workspaceId, tab } = useLocalSearchParams<{ hostId: string; workspaceId: string; tab?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const conn = useHostConn(hostId);
  const snapshot = useSnapshots((s) => s.byHost[hostId]);
  const spaceInfo = useMemo(() => (snapshot ? hostSpaces(snapshot).find((s) => s.workspaceId === workspaceId) : undefined), [snapshot, workspaceId]);
  const [picked, setPicked] = useState<string | undefined>(tab);
  const tabId = spaceInfo ? firstTab(spaceInfo, picked) : undefined;
  const selected = spaceInfo?.tabs.find((t) => t.tabId === tabId);
  const panes = useMemo(() => (selected?.panes ?? []).slice(0, MAX_THUMBS), [selected]);
  const paneIds = useMemo(() => panes.map((p) => p.paneId), [panes]);
  const texts = useThumbnails(hostId, paneIds, focused && conn.status === "online");
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: spaceInfo?.label ?? "Space" });
  }, [navigation, spaceInfo?.label]);

  // The folder of the space: the folder of its first pane that has one. A new terminal opens there.
  const folder = useMemo(() => {
    if (!snapshot) return undefined;
    const inSpace = (p: { workspace_id: string }) => p.workspace_id === workspaceId;
    const agent = snapshot.agents.find((a) => inSpace(a) && a.cwd);
    const pane = snapshot.panes.find((p) => inSpace(p) && (p.cwd || p.foreground_cwd));
    return agent?.cwd ?? pane?.cwd ?? pane?.foreground_cwd ?? undefined;
  }, [snapshot, workspaceId]);
  const canTab = !!folder && allows(workspaceId, "newTab", hostId);

  const open = (paneId: string) => router.push(`/session/${hostId}/${paneId}` as never);

  const newTerminal = async () => {
    const { rpc } = getHostConn(hostId);
    if (!rpc || !folder || busy) return;
    haptics.press();
    setBusy(true);
    try {
      const { paneId } = await startShell(rpc, { cwd: folder, workspaceId, hostId });
      expectPane(hostId, paneId, "shell");
      router.push({ pathname: "/session/[hostId]/[paneId]", params: { hostId, paneId, shell: "1" } } as never);
    } catch (e) {
      haptics.fail();
      Alert.alert("Can't open a terminal", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const more = () => {
    const { rpc } = getHostConn(hostId);
    if (!rpc) return;
    const items: { label: string; destructive?: boolean; onPick: () => void }[] = [];
    if (renameKindsFor(workspaceId, hostId).includes("workspace") && renameSupported(hostId, "workspace")) {
      items.push({ label: "Rename space", onPick: () => promptRename(rpc, hostId, "workspace", { workspace_id: workspaceId, tab_id: "", pane_id: "" }) });
    }
    if (allows(workspaceId, "closeGroup", hostId)) {
      items.push({
        label: "Close space",
        destructive: true,
        onPick: () =>
          Alert.alert("Close this space?", "This closes every agent and terminal in it.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Close",
              style: "destructive",
              onPress: () =>
                rpc.call("herdr.call", { method: "workspace.close", params: { workspace_id: workspaceId } }).then(
                  () => {
                    haptics.commit();
                    router.back();
                  },
                  (e) => {
                    haptics.fail();
                    Alert.alert("Can't close the space", e instanceof Error ? e.message : String(e));
                  },
                ),
            },
          ]),
      });
    }
    if (items.length === 0) {
      Alert.alert("No more actions", "Update herdlingd on this computer for more space actions.");
      return;
    }
    showActionSheet(
      { options: [...items.map((i) => i.label), "Cancel"], cancelButtonIndex: items.length, destructiveButtonIndex: items.flatMap((m, k) => (m.destructive ? [k] : [])) },
      (k) => items[k]?.onPick(),
    );
  };

  if (!spaceInfo) {
    return (
      <View style={{ flex: 1, padding: space.lg, backgroundColor: colors.bg }}>
        <StateNotice Icon={LayoutGrid} message={snapshot ? "This space is gone." : "Loading…"} />
      </View>
    );
  }

  // Two thumbnails in a row on a phone, three from the two-column width.
  const columns = layoutClass(width) === "regular" ? 3 : 2;
  const cell = `${100 / columns}%` as const;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: space.xxl }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md }}>
        {spaceInfo.tabs.map((t, i) => (
          <TabChip key={t.tabId} label={tabLabel(t, i)} selected={t.tabId === tabId} attention={t.attention > 0} onPress={() => setPicked(t.tabId)} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: space.md }}>
        {panes.map((p) => (
          <View key={p.paneId} style={{ width: cell, padding: space.xs }}>
            <PaneThumb pane={p} text={texts[p.paneId]} onPress={() => open(p.paneId)} />
          </View>
        ))}
        {panes.length === 0 ? (
          <View style={{ paddingHorizontal: space.sm }}>
            <StateNotice Icon={LayoutGrid} message="This tab has no panes." />
          </View>
        ) : null}
      </View>
      {(selected?.panes.length ?? 0) > MAX_THUMBS ? (
        <Text variant="caption" muted style={{ paddingHorizontal: space.lg }}>
          {`${(selected?.panes.length ?? 0) - MAX_THUMBS} more panes in this tab. Use the search to open them.`}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg }}>
        {canTab ? <Button label="Terminal" Icon={Plus} variant="secondary" loading={busy} onPress={() => void newTerminal()} /> : null}
        <Button
          label="New agent"
          Icon={Bot}
          variant="secondary"
          onPress={() => router.push({ pathname: "/new", params: { host: hostId, workspace: workspaceId } } as never)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More space actions"
          onPress={more}
          style={({ pressed }) => ({
            width: hitTarget,
            height: hitTarget,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <Ellipsis size={icon.md} color={colors.text} />
        </Pressable>
      </View>
    </ScrollView>
  );
}
