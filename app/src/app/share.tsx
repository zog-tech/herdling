/**
 * "Share to Herdling": what another app shared (a link with its preview, a text, photos, videos or
 * files), the agent to send it to (a picker row over the agents on every online computer), and a
 * note in the action bar. Send uploads the files like the composer
 * does, sends the prompt to the selected agent (`sendWithPending`) and opens its thread, where the
 * prompt shows as a pending bubble. The send runs in the state machine of `share/shareMachine.ts`.
 */
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { Link2, Share2, SquareTerminal, TriangleAlert } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, TextInput, View } from "react-native";

import { jumpDetail, type JumpHost, type JumpTask } from "@/board/jump";
import { useSnapshots } from "@/herdr/snapshotStore";
import { getHostConn, useHostConn, useOnlineHostKey } from "@/hosts/connection";
import { hasMethod } from "@/hosts/methods";
import { useHosts } from "@/hosts/store";
import {
  droppedText,
  ownCopies,
  planFiles,
  shareSummary,
  textAsFile,
  type SharedContent,
} from "@/share/content";
import { fetchLinkPreview, hostOf, type LinkPreview } from "@/share/openGraph";
import { shareBody } from "@/share/prompt";
import { initialShareState, shareReducer, type ShareEffect, type ShareEvent, type ShareState, type ShareTarget } from "@/share/shareMachine";
import { clearShareContent, useShareStore } from "@/share/shareStore";
import { initialTarget, shareTargets } from "@/share/targets";
import {
  canChunk,
  pathLines,
  UploadCanceled,
  uploadErrorText,
  uploadLabel,
  uploadPhotos,
  withPaths,
  type Attachment,
  type UploadProgress,
} from "@/thread/attachments";
import type { PastedText } from "@/thread/pastedText";
import { sendWithPending } from "@/thread/pending";
import { PhotoStrip } from "@/thread/PlusMenu";
import { colors, hitTarget, icon, radius, space, state as uiState, type } from "@/theme/tokens";
import { ActionBar } from "@/ui/ActionBar";
import { useDelayed } from "@/ui/Delayed";
import { Group, Section } from "@/ui/Group";
import { GroupTile } from "@/ui/GroupTile";
import * as haptics from "@/ui/haptics";
import { PickerRow } from "@/ui/PickerRow";
import { showPicker, type PickerOption } from "@/ui/PickerSheet";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { statusMeta } from "@/ui/StatusIcon";
import { Text } from "@/ui/Text";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

/** More agents than this: the picker gets a search field. */
const SEARCH_FROM = 6;
/** Width to height of a link image (the Open Graph size, 1200 x 630). */
const LINK_IMAGE_RATIO = 1.91;

/** The agent as a picker option: the task as the label; the group, branch, kind, place and status as the detail. */
function targetOption(t: JumpTask, multiHost: boolean): PickerOption<string> {
  const head = [t.group, t.branch].filter(Boolean).join(" · ");
  const status = t.status === "terminal" ? undefined : statusMeta(t.status).label;
  return {
    value: t.key,
    label: t.title,
    detail: [head, jumpDetail(t, multiHost), status].filter(Boolean).join(" · "),
    leading: t.group ? <GroupTile name={t.group} size={icon.lg} /> : <SquareTerminal size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />,
    keywords: [t.hostName, t.repo, t.folder].filter(Boolean).join(" "),
  };
}

/** The content side inset of a flush screen. */
function Inset({ children }: { children: React.ReactNode }) {
  return <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>{children}</View>;
}

/** The link card: the page image, the title and the site, or the plain link while there is no preview. */
function LinkCard({ url, preview }: { url: string; preview?: LinkPreview }) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = preview?.image && !imageFailed ? preview.image : undefined;
  return (
    // A preview of live content: the tile surface (`card` and a `divider` edge).
    <View style={{ borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.divider }}>
      {image ? (
        <Image
          source={{ uri: image }}
          accessibilityIgnoresInvertColors
          onError={() => setImageFailed(true)}
          resizeMode="cover"
          style={{ width: "100%", aspectRatio: LINK_IMAGE_RATIO, backgroundColor: colors.card }}
        />
      ) : null}
      <View style={{ padding: space.md, gap: space.xs }}>
        {preview?.title ? (
          <Text bold numberOfLines={2}>
            {preview.title}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Link2 size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
          <Text variant="small" muted numberOfLines={1} style={{ flex: 1 }}>
            {preview?.siteName ?? hostOf(url)}
          </Text>
        </View>
        <Text variant="caption" muted mono numberOfLines={1} ellipsizeMode="middle">
          {url}
        </Text>
      </View>
    </View>
  );
}

/** The preview of the link of `content`: the tags the sending app gave first, then the page itself. */
function useLinkPreview(content: SharedContent | undefined): LinkPreview | undefined {
  const [preview, setPreview] = useState<LinkPreview>();
  useEffect(() => {
    const url = content?.url;
    const given: LinkPreview | undefined = content?.title || content?.image ? { title: content.title, image: content.image } : undefined;
    setPreview(given);
    if (!url || (given?.title && given.image)) return;
    let alive = true;
    void fetchLinkPreview(url).then((p) => {
      if (alive && p) setPreview({ ...p, title: p.title ?? given?.title, image: p.image ?? given?.image });
    });
    return () => {
      alive = false;
    };
  }, [content]);
  return preview;
}

/** What one send takes: the files to upload and the prompt text before their paths. */
type SendJob = { items: (Attachment | PastedText)[]; body: string };

export default function ShareScreen() {
  const router = useRouter();
  const content = useShareStore((s) => s.content);
  const seq = useShareStore((s) => s.seq);
  const lastTarget = useShareStore((s) => s.lastTarget);
  // At a cold start from iOS, the screen opens before the shared data arrives.
  const waited = useDelayed(true, 3_000);

  const hosts = useHosts((s) => s.hosts);
  const onlineKey = useOnlineHostKey(hosts.map((h) => h.id));
  const byHost = useSnapshots((s) => s.byHost);
  const list: JumpHost[] = useMemo(() => {
    const online = new Set(onlineKey.split(",").filter(Boolean));
    return hosts.flatMap((h) => (online.has(h.id) && byHost[h.id] ? [{ hostId: h.id, hostName: h.name, snapshot: byHost[h.id] }] : []));
  }, [hosts, onlineKey, byHost]);
  const all = useMemo(() => shareTargets(list), [list]);
  const [picked, setPicked] = useState<ShareTarget>();
  const target = picked ? all.find((t) => t.hostId === picked.hostId && t.paneId === picked.paneId) : initialTarget(all, lastTarget);
  const multiHost = list.length > 1;

  const { hello } = useHostConn(target?.hostId ?? "");
  const chunked = canChunk(hello);
  const canFiles = hasMethod(hello, "files.put");
  const [note, setNote] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const preview = useLinkPreview(content);

  // A new share starts with an empty note and all of its files.
  useEffect(() => {
    setNote("");
    setRemoved([]);
  }, [seq]);
  // The copies of the iOS share extension go when the share is sent, dropped or replaced.
  useEffect(() => {
    const copies = content ? ownCopies(content.files) : [];
    return () => {
      for (const uri of copies) {
        try {
          new File(uri).delete();
        } catch {
          // Already gone.
        }
      }
    };
  }, [content]);
  // Leaving the screen drops a share that was not sent.
  useEffect(() => () => clearShareContent(), []);

  const files = (content?.files ?? []).filter((f) => !removed.includes(f.uri));
  const plan = planFiles(files, chunked);
  const textFile = textAsFile(content?.text, canFiles);
  const uploads: Attachment[] = plan.items;
  const dropped = droppedText(plan, chunked);
  const needsFiles = uploads.length > 0 || !!textFile;
  const body = content ? shareBody({ note, content, title: preview?.title, textInFile: !!textFile }) : "";

  const [machine, setMachine] = useState<ShareState>(initialShareState);
  const machineRef = useRef(machine);
  const [progress, setProgress] = useState<UploadProgress>();
  const abort = useRef<AbortController | undefined>(undefined);
  const job = useRef<SendJob>({ items: [], body: "" });
  useEffect(() => () => abort.current?.abort(), []);

  const dispatch = (e: ShareEvent) => {
    const r = shareReducer(machineRef.current, e);
    machineRef.current = r.state;
    setMachine(r.state);
    for (const fx of r.effects) run(fx);
  };

  const run = (fx: ShareEffect) => {
    switch (fx.type) {
      case "upload": {
        const rpc = getHostConn(fx.target.hostId).rpc;
        if (!rpc) {
          dispatch({ type: "uploadFailed", gen: fx.gen, message: "The computer is offline. Nothing was sent." });
          return;
        }
        const ctl = new AbortController();
        abort.current = ctl;
        setProgress({ index: 0, total: job.current.items.length, fraction: 0 });
        uploadPhotos(rpc, job.current.items, undefined, undefined, { chunked, onProgress: setProgress, signal: ctl.signal })
          .then((paths) => dispatch({ type: "uploaded", gen: fx.gen, paths }))
          .catch((e: unknown) => {
            // A cancel already moved the machine back to editing.
            if (e instanceof UploadCanceled) return;
            haptics.fail();
            dispatch({ type: "uploadFailed", gen: fx.gen, message: `Upload failed, nothing sent: ${uploadErrorText(e)}` });
          })
          .finally(() => {
            if (abort.current === ctl) abort.current = undefined;
            setProgress(undefined);
          });
        return;
      }
      case "abort":
        abort.current?.abort();
        return;
      case "deliver": {
        const rpc = getHostConn(fx.target.hostId).rpc;
        const full = withPaths(job.current.body, pathLines(job.current.items, fx.paths));
        // The thread shows the prompt as a pending bubble, with Retry when the send fails.
        if (rpc) void sendWithPending(rpc, fx.target.hostId, fx.target.paneId, full).catch(() => {});
        clearShareContent(fx.target);
        if (router.canDismiss()) router.dismiss();
        else router.replace("/");
        router.push(`/session/${fx.target.hostId}/${fx.target.paneId}` as never);
        return;
      }
    }
  };

  const busy = machine.phase !== "editing";
  const filesBlocked = needsFiles && !canFiles;
  const canSend = !!target && !busy && !filesBlocked && (body.trim().length > 0 || needsFiles);
  const send = () => {
    if (!target || !canSend) return;
    haptics.press();
    job.current = { items: textFile ? [...uploads, textFile] : uploads, body };
    dispatch({ type: "send", target: { hostId: target.hostId, paneId: target.paneId }, uploads: job.current.items.length > 0 });
  };

  if (!content) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StateNotice Icon={Share2} message={waited ? "Nothing to share. Share a link, a text or files to Herdling from another app." : "Opening the share…"} />
      </View>
    );
  }

  const error = machine.phase === "editing" ? machine.error : undefined;
  const problem = filesBlocked ? "This computer cannot receive files. Update herdlingd on it." : undefined;

  const options = all.map((t) => targetOption(t, multiHost));
  const choose = () =>
    showPicker({
      title: "Send to",
      options,
      value: target?.key,
      search: all.length > SEARCH_FROM,
      searchPlaceholder: "Task, group, branch or computer",
      onPick: (key) => {
        const t = all.find((x) => x.key === key);
        if (!t) return;
        haptics.tap();
        setPicked({ hostId: t.hostId, paneId: t.paneId });
      },
    });

  const footer = (
    <ActionBar
      keyboard
      primary={
        target
          ? { label: `Send to ${target.title}`, loading: busy, disabled: !canSend, onPress: send }
          : { label: "Select an agent", disabled: busy || all.length === 0, onPress: choose }
      }
    >
      {error || problem ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
          <TriangleAlert size={icon.sm} color={colors.danger} />
          <Text variant="small" color={colors.danger} style={{ flex: 1 }}>
            {error ?? problem}
          </Text>
        </View>
      ) : null}
      <TextInput
        accessibilityLabel="Note for the agent (optional)"
        value={note}
        onChangeText={setNote}
        editable={!busy}
        multiline
        placeholder="Note for the agent (optional)"
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        style={{
          minHeight: hitTarget,
          maxHeight: hitTarget * 3,
          paddingHorizontal: space.md,
          paddingTop: space.md,
          paddingBottom: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.raised,
          color: colors.text,
          fontSize: type.size.body,
          textAlignVertical: "top",
        }}
      />
      {progress ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text variant="small" muted style={{ flex: 1 }} accessibilityLiveRegion="polite">
            {uploadLabel(progress)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel the upload"
            onPress={() => dispatch({ type: "cancel" })}
            style={({ pressed }) => ({ minHeight: hitTarget, minWidth: hitTarget, alignItems: "center", justifyContent: "center", opacity: pressed ? uiState.pressedOpacity : 1 })}
          >
            <Text variant="small" bold>
              Cancel
            </Text>
          </Pressable>
        </View>
      ) : null}
    </ActionBar>
  );

  return (
    <Screen flush footer={footer}>
      <Section title={shareSummary({ ...content, files })}>
        <Inset>
          {content.url ? <LinkCard key={content.url} url={content.url} preview={preview} /> : null}
          {content.text && content.text !== content.url ? (
            <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.card, gap: space.xs }}>
              <Text variant="small" numberOfLines={8} selectable>
                {content.text}
              </Text>
              {textFile ? (
                <Text variant="caption" muted>
                  A long text: it goes to the agent as a .txt file.
                </Text>
              ) : null}
            </View>
          ) : null}
          {files.length > 0 ? <PhotoStrip photos={uploads} disabled={busy} onRemove={(a) => setRemoved((r) => [...r, a.uri])} /> : null}
          {dropped ? (
            <Text variant="small" color={colors.danger}>
              {dropped}
            </Text>
          ) : null}
        </Inset>
      </Section>

      <Section title="Send to">
        {all.length > 0 ? (
          <Group>
            <PickerRow
              title="Agent"
              placeholder="Choose"
              disabled={busy}
              value={target?.title}
              valueLeading={target ? options.find((o) => o.value === target.key)?.leading : undefined}
              onPress={choose}
              accessibilityHint="Opens the list of agents to choose from."
            />
          </Group>
        ) : (
          <StateNotice Icon={Share2} message={list.length === 0 ? "No computer is online." : "No agents are running. Start a session first."} />
        )}
      </Section>
    </Screen>
  );
}
