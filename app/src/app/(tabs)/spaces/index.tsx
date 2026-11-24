/**
 * The Spaces tab: the spaces of each online computer as the Herdr app shows them (a Herdr app
 * space or a fallback group), with a tiny map of their tabs and what needs you. The board keeps the
 * snapshots live (`HostWatcher`), so this tab only reads the store.
 */
import { useNavigation, useRouter } from "expo-router";
import { LayoutGrid, Plus } from "lucide-react-native";
import { useLayoutEffect, useMemo } from "react";
import { SectionList, View } from "react-native";

import { useSnapshots } from "@/herdr/snapshotStore";
import { useOnlineHostKey } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { hostSpaces, type Space } from "@/spaces/spaces";
import { SpaceRow } from "@/spaces/SpaceRow";
import { colors, space } from "@/theme/tokens";
import { Divider } from "@/ui/Group";
import { IconButton } from "@/ui/IconButton";
import { useScreenBottomPadding } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { Dot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

type Section = { hostId: string; title: string; data: Space[] };

export default function SpacesScreen() {
  const router = useRouter();
  const bottom = useScreenBottomPadding();
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
        <IconButton
          label="New session"
          hint="Starts an agent or a shell, in a space or a new space"
          Icon={Plus}
          size="header"
          onPress={() => router.push("/new" as never)}
        />
      ),
    });
  }, [navigation, router]);

  return (
    <SectionList
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: bottom }}
      sections={sections}
      keyExtractor={(s) => s.workspaceId}
      stickySectionHeadersEnabled={false}
      ItemSeparatorComponent={Divider}
      renderSectionHeader={({ section }) => (
        <View accessibilityRole="header" accessibilityLabel={`${section.title}, ${section.data.length} ${section.data.length === 1 ? "space" : "spaces"}`} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs }}>
          <View accessible accessibilityLabel="Online">
            <Dot color={colors.status.done} />
          </View>
          <Text variant="section" numberOfLines={1} style={{ flexShrink: 1 }}>
            {section.title}
          </Text>
          <Text variant="caption" muted>
            {String(section.data.length)}
          </Text>
        </View>
      )}
      renderItem={({ item, section }) => (
        <SpaceRow
          space={item}
          onPress={() => router.push({ pathname: "/spaces/[hostId]/[workspaceId]", params: { hostId: section.hostId, workspaceId: item.workspaceId } } as never)}
        />
      )}
      ListEmptyComponent={
        <StateNotice Icon={LayoutGrid} message={hosts.length === 0 ? "No computers yet. Add one in More, Computers." : "No computer is online, or it has no spaces."} />
      }
    />
  );
}
