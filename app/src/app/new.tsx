import { useNavigation, useRouter } from "expo-router";
import { ChevronRight, Folder, FolderOpen, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { AGENT_KINDS, DEFAULT_KIND, PRIMARY_KIND_COUNT } from "@/herdr/agentKinds";
import { startSession, workspaceExists } from "@/herdr/startSession";
import { useSnapshots } from "@/herdr/snapshotStore";
import { workspaceForCwd } from "@/herdr/workspaceForCwd";
import { useHostConn, useOnlineHostKey } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { colors, hitTarget, radius, space, type } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { MicButton } from "@/voice/MicButton";

type DirList = { path: string; dirs: string[]; recent_cwds: string[] };

const join = (base: string, name: string) => (base.endsWith("/") ? base : base + "/") + name;
const parent = (p: string) => p.replace(/\/[^/]+\/?$/, "") || "/";

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: hitTarget,
        paddingHorizontal: space.lg,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accent : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text bold color={selected ? colors.bg : colors.text}>
        {label}
      </Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="small" muted>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** A full path in JetBrains Mono, one line, truncated in the middle. */
function Path({ value, bold }: { value: string; bold?: boolean }) {
  return (
    <Text mono bold={bold} variant="small" numberOfLines={1} ellipsizeMode="middle">
      {value}
    </Text>
  );
}

function FolderPicker({ hostId, onPick }: { hostId: string; onPick: (path: string) => void }) {
  const { rpc } = useHostConn(hostId);
  const [list, setList] = useState<DirList>();
  const [error, setError] = useState<string>();
  const [path, setPath] = useState<string>();

  useEffect(() => {
    if (!rpc) return;
    let dead = false;
    setError(undefined);
    rpc
      .call<DirList>("fs.dirs", path ? { path } : {})
      .then((r) => !dead && setList(r))
      .catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
    };
  }, [rpc, path]);

  const current = list?.path;
  return (
    <View style={{ gap: space.lg }}>
      {list && list.recent_cwds.length > 0 ? (
        <Section title="RECENT">
          <Card style={{ paddingVertical: space.sm }}>
            {list.recent_cwds.slice(0, 6).map((c) => (
              <Row key={c} accessibilityLabel={`Use ${c}`} onPress={() => onPick(c)} trailing={<ChevronRight size={18} color={colors.textMuted} />}>
                <Path value={c} />
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}
      <Section title="BROWSE">
        <Card style={{ paddingVertical: space.sm }}>
          {error ? (
            <Text variant="small" color={colors.danger}>
              {error}
            </Text>
          ) : !list ? (
            <Text variant="small" muted>
              Loading…
            </Text>
          ) : (
            <>
              <Path value={list.path} bold />
              {list.path !== "/" ? (
                <Row accessibilityLabel="Parent folder" onPress={() => setPath(parent(list.path))}>
                  <Text muted mono variant="small">
                    ..
                  </Text>
                </Row>
              ) : null}
              {list.dirs.map((d) => (
                <Row
                  key={d}
                  accessibilityLabel={`Open ${d}`}
                  onPress={() => setPath(join(list.path, d))}
                  trailing={<ChevronRight size={18} color={colors.textMuted} />}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                    <Folder size={18} color={colors.textMuted} />
                    <Text mono variant="small" numberOfLines={1} style={{ flex: 1 }}>
                      {d}
                    </Text>
                  </View>
                </Row>
              ))}
              {list.dirs.length === 0 ? (
                <Text variant="small" muted>
                  No sub-folders.
                </Text>
              ) : null}
            </>
          )}
        </Card>
        <Button label="Use this folder" Icon={FolderOpen} disabled={!current} onPress={() => current && onPick(current)} />
      </Section>
    </View>
  );
}

export default function NewSessionScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const hosts = useHosts((s) => s.hosts);
  const onlineKey = useOnlineHostKey(hosts.map((h) => h.id));
  const online = useMemo(() => hosts.filter((h) => onlineKey.split(",").includes(h.id)), [hosts, onlineKey]);

  const [hostId, setHostId] = useState<string>();
  const [cwd, setCwd] = useState<string>();
  const [kind, setKind] = useState<string>(DEFAULT_KIND);
  const [more, setMore] = useState(false);
  const [prompt, setPrompt] = useState("");
  /** Live transcript while the mic is held. */
  const [heard, setHeard] = useState("");
  const [newWorkspace, setNewWorkspace] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();

  // Default to the first online host; drop the choice if that host goes offline.
  useEffect(() => {
    if (!hostId || !online.some((h) => h.id === hostId)) setHostId(online[0]?.id);
  }, [online, hostId]);
  useEffect(() => setCwd(undefined), [hostId]);

  const { rpc } = useHostConn(hostId ?? "");
  const snapshot = useSnapshots((s) => (hostId ? s.byHost[hostId] : undefined));
  const existing = useMemo(() => (cwd ? workspaceForCwd(snapshot, cwd) : undefined), [snapshot, cwd]);
  useEffect(() => setNewWorkspace(false), [cwd]);

  const busy = progress !== undefined;
  // Swiping the sheet away mid-start would leave a half-started session behind.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !busy });
  }, [navigation, busy]);
  const start = useCallback(async () => {
    if (!rpc || !hostId || !cwd) return;
    setError(undefined);
    setProgress("Creating workspace…");
    try {
      // The snapshot can lag: fall back to a new workspace when the old one is gone.
      const reuse = existing && !newWorkspace && (await workspaceExists(rpc, existing.workspace_id));
      const { paneId, promptError } = await startSession(rpc, {
        cwd,
        kind,
        prompt,
        workspaceId: reuse && existing ? existing.workspace_id : undefined,
        onProgress: setProgress,
      });
      // The agent runs even when the prompt failed: open it with the prompt ready to resend.
      router.replace(
        (promptError
          ? { pathname: "/session/[hostId]/[paneId]", params: { hostId, paneId, prompt, promptError } }
          : `/session/${hostId}/${paneId}`) as never,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(undefined);
    }
  }, [rpc, hostId, cwd, kind, prompt, existing, newWorkspace, router]);

  const primary = AGENT_KINDS.slice(0, PRIMARY_KIND_COUNT);
  const rest = AGENT_KINDS.slice(PRIMARY_KIND_COUNT);
  // A selected kind from "More" stays visible even when that list is collapsed.
  const showRest = more || rest.includes(kind as never);

  if (online.length === 0)
    return (
      <Screen>
        <Text muted>No host is online. Connect a host first.</Text>
      </Screen>
    );

  return (
    <Screen>
      {online.length > 1 ? (
        <Section title="HOST">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {online.map((h) => (
              <Chip key={h.id} label={h.name} selected={h.id === hostId} onPress={() => !busy && setHostId(h.id)} />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="FOLDER">
        {cwd ? (
          <Card style={{ gap: space.sm }}>
            <Path value={cwd} bold />
            <Button label="Change folder" variant="secondary" disabled={busy} onPress={() => setCwd(undefined)} />
          </Card>
        ) : hostId ? (
          <FolderPicker hostId={hostId} onPick={setCwd} />
        ) : null}
      </Section>

      {cwd ? (
        <>
          {existing ? (
            <Section title="WHERE">
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                <Chip label={`New tab in ${existing.label}`} selected={!newWorkspace} onPress={() => setNewWorkspace(false)} />
                <Chip label="New workspace" selected={newWorkspace} onPress={() => setNewWorkspace(true)} />
              </View>
            </Section>
          ) : null}

          <Section title="AGENT">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {primary.map((k) => (
                <Chip key={k} label={k} selected={k === kind} onPress={() => setKind(k)} />
              ))}
              {showRest ? rest.map((k) => <Chip key={k} label={k} selected={k === kind} onPress={() => setKind(k)} />) : null}
              {!showRest ? <Chip label="More" selected={false} onPress={() => setMore(true)} /> : null}
            </View>
          </Section>

          <Section title="FIRST PROMPT (OPTIONAL)">
            <TextInput
              accessibilityLabel="First prompt"
              value={prompt}
              onChangeText={setPrompt}
              editable={!busy}
              multiline
              placeholder="What should the agent do?"
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.accent}
              style={{
                minHeight: 120,
                padding: space.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.muted,
                color: colors.text,
                fontSize: type.size.body,
                textAlignVertical: "top",
              }}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Text variant="small" muted numberOfLines={3} style={{ flex: 1 }}>
                {heard || "Hold the mic to dictate."}
              </Text>
              <MicButton
                disabled={busy}
                onPartial={setHeard}
                onSend={(t) => setPrompt((p) => (p.trim() ? `${p.trimEnd()} ${t}` : t))}
              />
            </View>
          </Section>

          {error ? (
            <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
              <TriangleAlert size={18} color={colors.danger} />
              <Text variant="small" color={colors.danger} style={{ flex: 1 }}>
                {error}
              </Text>
            </View>
          ) : null}
          <Button label={busy ? progress : `Start ${kind}`} loading={busy} onPress={() => void start()} />
        </>
      ) : null}
    </Screen>
  );
}
