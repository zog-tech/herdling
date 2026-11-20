import type { FileGet, FileGetParams } from "@herdling/protocol";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Share as ShareIcon } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, View } from "react-native";

import { fileHref } from "@/files/open";
import { FileViewer, useFileViewer } from "@/files/FileViewer";
import { baseName, isRelativePath } from "@/files/paths";
import { shareShown } from "@/files/share";
import { useSnapshots } from "@/herdr/snapshotStore";
import { useHostConn } from "@/hosts/connection";
import { RpcError } from "@/rpc/RpcClient";
import { colors, hitTarget, icon, state } from "@/theme/tokens";

/**
 * Screen: a path on a computer, opened from the thread. A folder lists its entries (a tap opens an
 * entry, the first row opens the parent folder), an image opens with pinch zoom, a text file shows
 * read-only in monospace. Search params: `path`, and `paneId` or `cwd` for a relative path.
 */
export default function FileScreen() {
  const { hostId, path = "", paneId, cwd: cwdParam } = useLocalSearchParams<{ hostId: string; path?: string; paneId?: string; cwd?: string }>();
  const router = useRouter();
  const { rpc } = useHostConn(hostId);
  // The folder of the agent in the pane. Without it, herdlingd asks the core for the pane folder.
  const agentCwd = useSnapshots((s) => (paneId ? s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.cwd : undefined));
  const cwd = cwdParam || agentCwd || undefined;

  const params = useCallback(
    (p: string, offset: number): FileGetParams => ({
      path: p,
      ...(offset > 0 ? { offset } : {}),
      ...(isRelativePath(p) ? (cwd ? { cwd } : paneId ? { pane_id: paneId } : {}) : {}),
    }),
    [cwd, paneId],
  );
  const fetchFile = useCallback(
    (offset: number) => (rpc ? rpc.call<FileGet>("files.get", params(path, offset)) : Promise.reject(new RpcError("offline", "The computer is offline."))),
    // A new rpc (after a reconnect) loads again: a failed load then recovers by itself.
    [rpc, path, params],
  );
  const fetchThumb = useCallback(
    (p: string) => (rpc ? rpc.call<FileGet>("files.get", { path: p }) : Promise.reject(new RpcError("offline", "The computer is offline."))),
    [rpc],
  );
  const { state: view, retry } = useFileViewer(fetchFile);
  const open = useCallback((p: string) => router.push(fileHref(hostId, p) as never), [router, hostId]);

  const shown = view.kind === "ready" && view.file.kind !== "dir" ? view.file : undefined;
  const title = view.kind === "ready" ? view.file.name : baseName(path);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title,
          headerRight: shown
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Share"
                  onPress={() => void shareShown(shown).catch(() => {})}
                  style={({ pressed }) => ({ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center", opacity: pressed ? state.pressedOpacity : 1 })}
                >
                  <ShareIcon size={icon.md} color={colors.text} strokeWidth={icon.strokeWidth} />
                </Pressable>
              )
            : undefined,
        }}
      />
      <FileViewer view={view} onRetry={retry} onOpen={open} fetchThumb={fetchThumb} />
    </View>
  );
}
