import type { FileDir, FileEntry, FileGet } from "@herdling/protocol";
import { File, FileText, Folder, FolderUp, ImageOff, TriangleAlert, type LucideIcon } from "lucide-react-native";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, icon, radius, space, state, textRole, themed, type } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import { formatBytes } from "@/ui/format";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

import { childPath, parentPath } from "./paths";
import { imageUri } from "./share";
import { THUMB_MAX, thumbs, type ThumbLoader } from "./thumbs";
import { failText, initialViewer, viewerReducer, type Shown, type ViewerEffect, type ViewerEvent, type ViewerState } from "./viewerMachine";
import { ZoomImage } from "./ZoomImage";

/** Size of a thumbnail or an entry icon box. */
const THUMB = 36;
const TEXT_LINE = Math.round(textRole.mono.size * type.lineHeight.body);
/** The text cap of herdlingd (`files::TEXT_MAX`). */
const TEXT_SHOWN = 256 << 10;

const errCode = (e: unknown) => (typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "error");
const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The load flow (see `viewerMachine.ts`): sends the events and runs the fetch effects. A new
 * `fetchFile` (another path) starts a new load.
 */
export function useFileViewer(fetchFile: (offset: number) => Promise<FileGet>): { state: ViewerState; retry: () => void } {
  const [st, setSt] = useState<ViewerState>(initialViewer);
  const ref = useRef(st);
  const fetchRef = useRef(fetchFile);
  fetchRef.current = fetchFile;
  const send = useCallback((ev: ViewerEvent) => {
    const r = viewerReducer(ref.current, ev);
    ref.current = r.state;
    setSt(r.state);
    r.effects.forEach(run);
  }, []);
  // A function statement: `send` and `run` call each other.
  function run(e: ViewerEffect) {
    fetchRef.current(e.offset).then(
      (result) => send({ type: "result", gen: e.gen, result }),
      (err: unknown) => send({ type: "error", gen: e.gen, code: errCode(err), message: errMessage(err) }),
    );
  }
  useEffect(() => send({ type: "load" }), [fetchFile, send]);
  return { state: st, retry: useCallback(() => send({ type: "load" }), [send]) };
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: space.lg }}>{children}</View>;
}

/** The thumbnail of a small image in a folder, or an icon. It loads when the row is drawn. */
function Thumb({ path, size, loader, fetchThumb }: { path: string; size?: number; loader: ThumbLoader; fetchThumb?: (path: string) => Promise<FileGet> }) {
  const small = fetchThumb !== undefined && size !== undefined && size > 0 && size <= THUMB_MAX;
  const [uri, setUri] = useState<string | null | undefined>(() => (small ? loader.get(path) : null));
  useEffect(() => {
    if (!small || uri !== undefined) return;
    let live = true;
    void loader
      .load(path, async () => {
        const r = await fetchThumb(path);
        return r.kind === "image" && r.eof ? (imageUri(r) ?? null) : null;
      })
      .then((v) => live && setUri(v));
    return () => {
      live = false;
    };
  }, [small, uri, path, loader, fetchThumb]);
  if (uri) return <Image source={{ uri }} style={styles().thumb} resizeMode="cover" accessibilityIgnoresInvertColors />;
  return <EntryIcon Icon={File} />;
}

function EntryIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <View style={[styles().thumb, { alignItems: "center", justifyContent: "center", backgroundColor: colors.raised }]}>
      <Icon size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
    </View>
  );
}

const EntryRow = memo(function EntryRow({
  dir,
  entry,
  onOpen,
  loader,
  fetchThumb,
}: {
  dir: string;
  entry: FileEntry;
  onOpen: (path: string) => void;
  loader: ThumbLoader;
  fetchThumb?: (path: string) => Promise<FileGet>;
}) {
  const path = childPath(dir, entry.name);
  const sizeText = entry.size !== undefined ? formatBytes(entry.size) : undefined;
  const kindWord = entry.kind === "dir" ? "Folder" : entry.kind === "image" ? "Image" : "File";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${kindWord} ${entry.name}${sizeText ? `, ${sizeText}` : ""}`}
      onPress={() => onOpen(path)}
      style={({ pressed }) => [styles().row, { opacity: pressed ? state.pressedOpacity : 1 }]}
    >
      {entry.kind === "dir" ? (
        <EntryIcon Icon={Folder} />
      ) : entry.kind === "image" ? (
        <Thumb path={path} size={entry.size} loader={loader} fetchThumb={fetchThumb} />
      ) : (
        <EntryIcon Icon={FileText} />
      )}
      <Text numberOfLines={1} style={{ flex: 1 }}>
        {entry.name}
      </Text>
      {sizeText ? (
        <Text variant="caption" muted>
          {sizeText}
        </Text>
      ) : null}
    </Pressable>
  );
});

function DirView({ dir, onOpen, fetchThumb, loader }: { dir: FileDir; onOpen: (path: string) => void; fetchThumb?: (path: string) => Promise<FileGet>; loader: ThumbLoader }) {
  const parent = parentPath(dir.path);
  const header = parent ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Parent folder"
      onPress={() => onOpen(parent)}
      style={({ pressed }) => [styles().row, { opacity: pressed ? state.pressedOpacity : 1 }]}
    >
      <EntryIcon Icon={FolderUp} />
      <Text muted numberOfLines={1} style={{ flex: 1 }}>
        {parent}
      </Text>
    </Pressable>
  ) : undefined;
  return (
    <FlatList
      data={dir.entries}
      keyExtractor={(e) => e.name}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Text muted style={{ padding: space.lg }}>
          This folder is empty.
        </Text>
      }
      ListFooterComponent={
        dir.truncated ? (
          <Text variant="caption" muted style={{ padding: space.lg }}>
            {`Only the first ${dir.entries.length} entries show.`}
          </Text>
        ) : undefined
      }
      ItemSeparatorComponent={Separator}
      contentContainerStyle={{ paddingBottom: space.xxl }}
      renderItem={({ item }) => <EntryRow dir={dir.path} entry={item} onOpen={onOpen} loader={loader} fetchThumb={fetchThumb} />}
    />
  );
}

function Separator() {
  return <View style={styles().separator} />;
}

/** A file that the viewer does not show: its name, size and type. */
function FileFacts({ file, note, Icon = File }: { file: Shown; note?: string; Icon?: LucideIcon }) {
  const size = "size" in file ? formatBytes(file.size) : undefined;
  const mime = "mime" in file ? file.mime : undefined;
  const ext = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toUpperCase();
  const kind = mime ?? (ext ? `${ext} file` : "File");
  return (
    <Centered>
      <View style={{ alignItems: "center", gap: space.sm }}>
        <Icon size={icon.lg * 2} color={colors.textMuted} strokeWidth={1.5} />
        <Text variant="headline" style={{ textAlign: "center" }}>
          {file.name}
        </Text>
        <Text variant="small" muted style={{ textAlign: "center" }}>
          {[size, kind].filter(Boolean).join(" · ")}
        </Text>
        {note ? (
          <Text variant="small" muted style={{ textAlign: "center", marginTop: space.sm }}>
            {note}
          </Text>
        ) : null}
      </View>
    </Centered>
  );
}

function ImageView({ file }: { file: Extract<Shown, { kind: "image" }> }) {
  const [broken, setBroken] = useState(false);
  const uri = imageUri(file);
  if (file.too_large) return <FileFacts file={file} Icon={ImageOff} note="This image is too large to show on the phone." />;
  if (!uri || broken) return <FileFacts file={file} Icon={ImageOff} note="This phone cannot show this image." />;
  return <ZoomImage uri={uri} label={file.name} onError={() => setBroken(true)} />;
}

function TextView({ file }: { file: Extract<Shown, { kind: "text" }> }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      {file.truncated ? (
        <View style={styles().note}>
          <Text variant="caption" muted>
            {`Only the first ${formatBytes(TEXT_SHOWN)} shows. The file has ${formatBytes(file.size)}.`}
          </Text>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <Text selectable style={styles().code}>
          {file.text || " "}
        </Text>
      </ScrollView>
    </ScrollView>
  );
}

/**
 * The body of the file viewer: a spinner, the error with Retry, a folder list, an image with pinch
 * zoom, a text file in monospace, or the facts of another file. `onOpen` opens another path (an
 * entry or the parent folder). `fetchThumb` loads the thumbnails of small images.
 */
export function FileViewer({
  view,
  onRetry,
  onOpen,
  fetchThumb,
  loader = thumbs,
}: {
  view: ViewerState;
  onRetry: () => void;
  onOpen: (path: string) => void;
  fetchThumb?: (path: string) => Promise<FileGet>;
  loader?: ThumbLoader;
}) {
  switch (view.kind) {
    case "loading":
      return (
        <Centered>
          <View style={{ alignItems: "center" }}>
            <DelayedSpinner color={colors.textMuted} />
          </View>
        </Centered>
      );
    case "parts":
      return (
        <Centered>
          <View style={{ alignItems: "center", gap: space.sm }}>
            <DelayedSpinner color={colors.textMuted} />
            <Text variant="caption" muted>
              {`Loading the image: ${Math.floor((view.received / Math.max(1, view.meta.size)) * 100)}%`}
            </Text>
          </View>
        </Centered>
      );
    case "failed":
      return (
        <Centered>
          <StateNotice Icon={TriangleAlert} color={colors.danger} message={failText(view.code, view.message)} action="Retry" onAction={onRetry} />
        </Centered>
      );
    case "ready": {
      const f = view.file;
      switch (f.kind) {
        case "dir":
          return <DirView dir={f} onOpen={onOpen} fetchThumb={fetchThumb} loader={loader} />;
        case "image":
          return <ImageView file={f} />;
        case "text":
          return <TextView file={f} />;
        case "other":
          return <FileFacts file={f} note="The phone does not show this type of file." />;
      }
    }
  }
}

const styles = themed(() =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: hitTarget + space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs },
    thumb: { width: THUMB, height: THUMB, borderRadius: radius.sm, backgroundColor: colors.raised },
    separator: { height: StyleSheet.hairlineWidth, marginLeft: space.lg + THUMB + space.md, backgroundColor: colors.divider },
    note: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.card },
    code: { fontFamily: fontFamily.mono, fontSize: textRole.mono.size, lineHeight: TEXT_LINE, color: colors.text },
  }),
);
