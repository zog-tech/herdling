/**
 * "Jump to a terminal": a search over every agent and terminal on every online computer, grouped
 * by task with the helpers under it (`board/jump.ts`). A tap opens the session. The screen skeleton
 * of design rule 4: the native header with the title, the search field, then the rows.
 */
import { useRouter } from "expo-router";
import { SearchX } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";

import { filterJump, jumpTasks, type JumpHost } from "@/board/jump";
import { JumpRow } from "@/board/JumpRow";
import { useSnapshots } from "@/herdr/snapshotStore";
import { useOnlineHostKey } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { colors, space } from "@/theme/tokens";
import { Divider } from "@/ui/Group";
import { useScreenBottomPadding } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { SearchField } from "@/ui/SearchField";

export default function JumpScreen() {
  const router = useRouter();
  const hosts = useHosts((s) => s.hosts);
  const onlineKey = useOnlineHostKey(hosts.map((h) => h.id));
  const byHost = useSnapshots((s) => s.byHost);
  const [query, setQuery] = useState("");
  const bottom = useScreenBottomPadding();
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
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Task, group, branch or computer"
        accessibilityLabel="Jump to a terminal"
        autoFocus
        onSubmitEditing={() => tasks[0] && open(tasks[0].hostId, tasks[0].paneId)}
        style={{ margin: space.lg }}
      />
      <FlatList
        data={tasks}
        keyExtractor={(t) => t.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // The last row ends above the home indicator.
        contentContainerStyle={{ paddingBottom: bottom }}
        ItemSeparatorComponent={Divider}
        renderItem={({ item }) => <JumpRow task={item} multiHost={multiHost} onOpen={(paneId) => open(item.hostId, paneId)} />}
        ListEmptyComponent={
          <StateNotice
            Icon={SearchX}
            message={list.length === 0 ? "No computer is online." : query.trim() ? `Nothing matches “${query.trim()}”.` : "No agents or terminals."}
          />
        }
      />
    </View>
  );
}
