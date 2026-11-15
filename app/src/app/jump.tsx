/**
 * "Jump to a terminal": a search over every agent and terminal on every online computer, grouped
 * by task with the helpers under it (`board/jump.ts`). A tap opens the session.
 */
import { useRouter } from "expo-router";
import { Search, SearchX } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, TextInput, View } from "react-native";

import { filterJump, jumpTasks, type JumpHost } from "@/board/jump";
import { JumpRow } from "@/board/JumpRow";
import { useSnapshots } from "@/herdr/snapshotStore";
import { useOnlineHostKey } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { colors, hitTarget, icon, radius, space, type } from "@/theme/tokens";
import { Divider } from "@/ui/Group";
import { StateNotice } from "@/ui/StateNotice";

export default function JumpScreen() {
  const router = useRouter();
  const hosts = useHosts((s) => s.hosts);
  const onlineKey = useOnlineHostKey(hosts.map((h) => h.id));
  const byHost = useSnapshots((s) => s.byHost);
  const [query, setQuery] = useState("");
  const list: JumpHost[] = useMemo(() => {
    const online = new Set(onlineKey.split(",").filter(Boolean));
    return hosts.flatMap((h) => (online.has(h.id) && byHost[h.id] ? [{ hostId: h.id, hostName: h.name, snapshot: byHost[h.id] }] : []));
  }, [hosts, onlineKey, byHost]);
  const tasks = useMemo(() => filterJump(jumpTasks(list), query), [list, query]);
  const multiHost = list.length > 1;
  const open = (hostId: string, paneId: string) => {
    router.dismiss();
    router.push(`/session/${hostId}/${paneId}` as never);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          margin: space.lg,
          minHeight: hitTarget,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          backgroundColor: colors.raised,
        }}
      >
        <Search size={icon.sm} color={colors.textMuted} />
        <TextInput
          accessibilityLabel="Jump to a terminal"
          value={query}
          onChangeText={setQuery}
          placeholder="Task, group, branch or computer"
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          onSubmitEditing={() => tasks[0] && open(tasks[0].hostId, tasks[0].paneId)}
          style={{ flex: 1, color: colors.text, fontSize: type.size.body, paddingVertical: space.sm }}
        />
      </View>
      <FlatList
        data={tasks}
        keyExtractor={(t) => t.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ItemSeparatorComponent={Divider}
        renderItem={({ item }) => <JumpRow task={item} multiHost={multiHost} onOpen={(paneId) => open(item.hostId, paneId)} />}
        ListEmptyComponent={
          <View style={{ paddingHorizontal: space.lg }}>
            <StateNotice
              Icon={SearchX}
              message={list.length === 0 ? "No computer is online." : query.trim() ? `Nothing matches “${query.trim()}”.` : "No agents or terminals."}
            />
          </View>
        }
      />
    </View>
  );
}
