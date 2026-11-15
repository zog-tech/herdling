/**
 * The Spaces tab: the spaces of each online computer as the Herdr app shows them (a Herdr app
 * space or a fallback group), with a tiny map of their tabs and what needs you. The board keeps the
 * snapshots live (`HostWatcher`), so this tab only reads the store.
 */
import { useNavigation, useRouter } from "expo-router";
import { LayoutGrid, Monitor, Plus } from "lucide-react-native";
import { useLayoutEffect, useMemo } from "react";
import { Pressable, SectionList, View } from "react-native";

import { useSnapshots } from "@/herdr/snapshotStore";
import { useOnlineHostKey } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { hostSpaces, type Space } from "@/spaces/spaces";
import { SpaceRow } from "@/spaces/SpaceRow";
import { colors, hitTarget, icon, space, state } from "@/theme/tokens";
import { Divider } from "@/ui/Group";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

type Section = { hostId: string; title: string; data: Space[] };

export default function SpacesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const hosts = useHosts((s) => s.hosts);
  const onlineKey = useOnlineHostKey(hosts.map((h) => h.id));
  const byHost = useSnapshots((s) => s.byHost);
  const sections: Section[] = useMemo(() => {
    const online = new Set(onlineKey.split(",").filter(Boolean));
    return hosts.flatMap((h) => (online.has(h.id) && byHost[h.id] ? [{ hostId: h.id, title: h.name, data: hostSpaces(byHost[h.id]) }] : []));
  }, [hosts, onlineKey, byHost]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New session"
          accessibilityHint="Starts an agent or a shell, in a space or a new space"
          onPress={() => router.push("/new" as never)}
          style={({ pressed }) => ({ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center", opacity: pressed ? state.pressedOpacity : 1 })}
        >
          <Plus size={icon.md} color={colors.text} strokeWidth={icon.strokeWidth} />
        </Pressable>
      ),
    });
  }, [navigation, router]);

  return (
    <SectionList
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(s) => s.workspaceId}
      stickySectionHeadersEnabled={false}
      ItemSeparatorComponent={Divider}
      renderSectionHeader={({ section }) => (
        <View accessibilityRole="header" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs }}>
          <Monitor size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
          <Text variant="section">{section.title}</Text>
        </View>
      )}
      renderItem={({ item, section }) => (
        <SpaceRow
          space={item}
          onPress={() => router.push({ pathname: "/spaces/[hostId]/[workspaceId]", params: { hostId: section.hostId, workspaceId: item.workspaceId } } as never)}
        />
      )}
      ListEmptyComponent={
        <View style={{ padding: space.lg }}>
          <StateNotice Icon={LayoutGrid} message={hosts.length === 0 ? "No hosts yet. Add one on the Overview tab." : "No computer is online, or it has no spaces."} />
        </View>
      }
    />
  );
}
