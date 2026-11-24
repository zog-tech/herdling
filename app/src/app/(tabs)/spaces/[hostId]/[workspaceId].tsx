/**
 * One space: the tabs (none for one tab, a `Segmented` for 2 to 4, a `PickerRow` for more), the
 * panes of the selected tab as live thumbnails, the "⋯" header menu (rename, close) and the
 * bottom `ActionBar` ("New agent", "Terminal"). Only the thumbnails of the selected tab read their
 * screens, slowly, and only while the screen shows (`useThumbnails`).
 */
import { useIsFocused, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Bot, Ellipsis, LayoutGrid, Pencil, SquareTerminal, X } from "lucide-react-native";
import { useLayoutEffect, useMemo, useState } from "react";
import { Alert, ScrollView, useWindowDimensions, View } from "react-native";

import { allows, isCoreEntry, renameKindsFor } from "@/herdr/backend";
import { expectPane } from "@/herdr/expectedPanes";
import { promptRename, renameSupported } from "@/herdr/rename";
import { useSnapshots } from "@/herdr/snapshotStore";
import { startShell } from "@/herdr/startSession";
import { getHostConn, useHostConn } from "@/hosts/connection";
import { closeSpaceParams, firstTab, hostSpaces, MAX_THUMBS, spaceFolder, tabLabel } from "@/spaces/spaces";
import { PaneThumb } from "@/spaces/PaneThumb";
import { useThumbnails } from "@/spaces/useThumbnails";
import { colors, space } from "@/theme/tokens";
import { ActionBar, useActionBarSpace } from "@/ui/ActionBar";
import { Group } from "@/ui/Group";
import * as haptics from "@/ui/haptics";
import { IconButton } from "@/ui/IconButton";
import { layoutClass } from "@/ui/layout";
import { showMenu, type MenuItem } from "@/ui/MenuSheet";
import { PickerRow } from "@/ui/PickerRow";
import { Segmented } from "@/ui/Segmented";
import { StateNotice } from "@/ui/StateNotice";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

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
  const bar = useActionBarSpace();

  // The folder of the space: the folder of its first pane that has one. A new terminal opens there.
  const folder = useMemo(() => (snapshot ? spaceFolder(snapshot, workspaceId) : undefined), [snapshot, workspaceId]);
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
    const items: MenuItem[] = [];
    if (renameKindsFor(workspaceId, hostId).includes("workspace") && renameSupported(hostId, "workspace")) {
      items.push({ label: "Rename space", Icon: Pencil, onPick: () => promptRename(rpc, hostId, "workspace", { workspace_id: workspaceId, tab_id: "", pane_id: "" }) });
    }
    if (allows(workspaceId, "closeGroup", hostId)) {
      items.push({
        label: "Close space",
        Icon: X,
        destructive: true,
        onPick: () =>
          Alert.alert("Close this space?", "This closes every agent and terminal in it.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Close",
              style: "destructive",
              onPress: () =>
                rpc.call("herdr.call", { method: "workspace.close", params: closeSpaceParams(spaceInfo ?? { workspaceId, tabs: [] }, isCoreEntry(workspaceId, hostId)) }).then(
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
    showMenu({ title: spaceInfo?.label ?? "Space", sections: [{ items }] });
  };

  // The header: the space name and the "⋯" button. `more` reads fresh state, so the effect keeps a ref-free closure.
  useLayoutEffect(() => {
    navigation.setOptions({
      title: spaceInfo?.label ?? "Space",
      headerRight: () => (
        <IconButton label="Space actions" hint="Opens the menu to rename or close the space" Icon={Ellipsis} size="header" onPress={more} />
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, spaceInfo, hostId, workspaceId]);

  if (!spaceInfo) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StateNotice Icon={LayoutGrid} message={snapshot ? "This space is gone." : "Loading…"} />
      </View>
    );
  }

  // Two thumbnails in a row on a phone, three from the two-column width.
  const columns = layoutClass(width) === "regular" ? 3 : 2;
  const cell = `${100 / columns}%` as const;

  const tabs = spaceInfo.tabs;
  const needYou = tabs.flatMap((t, i) => (t.attention > 0 ? [tabLabel(t, i)] : []));
  const multi = tabs.length > 1;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: space.md, paddingBottom: bar.contentPadding, gap: space.md }}
      >
        {tabs.length >= 2 && tabs.length <= 4 ? (
          <View style={{ paddingHorizontal: space.lg }}>
            <Segmented
              label="Tabs"
              value={tabId ?? tabs[0].tabId}
              onChange={setPicked}
              options={tabs.map((t, i) => ({ id: t.tabId, label: tabLabel(t, i), attention: t.attention > 0 ? "needs you" : undefined }))}
            />
          </View>
        ) : null}
        {tabs.length > 4 ? (
          <Group>
            <PickerRow
              title="Tab"
              picker={{
                options: tabs.map((t, i) => ({ value: t.tabId, label: tabLabel(t, i), detail: t.attention > 0 ? "Needs you" : undefined })),
                value: tabId,
                onPick: setPicked,
              }}
            />
          </Group>
        ) : null}
        {multi && needYou.length > 0 ? (
          <View style={{ paddingHorizontal: space.lg }}>
            <StatusDot label={`${needYou.join(", ")} ${needYou.length === 1 ? "needs" : "need"} you`} color={colors.status.blocked} />
          </View>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: space.md }}>
          {panes.map((p) => (
            <View key={p.paneId} style={{ width: cell, padding: space.xs }}>
              <PaneThumb pane={p} text={texts[p.paneId]} onPress={() => open(p.paneId)} />
            </View>
          ))}
        </View>
        {panes.length === 0 ? (
          <StateNotice Icon={LayoutGrid} message="This tab has no panes." />
        ) : null}
        {(selected?.panes.length ?? 0) > MAX_THUMBS ? (
          <Text variant="caption" muted style={{ paddingHorizontal: space.lg }}>
            {`${(selected?.panes.length ?? 0) - MAX_THUMBS} more panes in this tab. Use the search to open them.`}
          </Text>
        ) : null}
      </ScrollView>
      <ActionBar
        onSpace={bar.onSpace}
        primary={{ label: "New agent", Icon: Bot, onPress: () => router.push({ pathname: "/new", params: { host: hostId, workspace: workspaceId } } as never) }}
        secondary={canTab ? { label: "Terminal", Icon: SquareTerminal, loading: busy, onPress: () => void newTerminal() } : undefined}
      />
    </View>
  );
}
