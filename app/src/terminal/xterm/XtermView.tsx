import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { View } from "react-native";

import { loadWebView, type WebViewHandle } from "@/preview/webview";
import { colors, space, type } from "@/theme/tokens";
import { openSelectText } from "@/thread/selectText";
import { useDebounced } from "@/thread/useThreadSearch";
import { Text } from "@/ui/Text";

import type { WidthMode } from "../fit";
import { loadXtermAssets } from "./assets";
import { OUTBOX_START, outboxReducer, parseFromWeb, type ToWeb } from "./bridge";
import { cellRatio, xtermLayout, type CellRatio } from "./layout";
import { xtermHtml } from "./page";
import { searchOp, type SearchState } from "./search";
import { searchDecorations, xtermTheme } from "./theme";
import { useVtStream } from "./useVtStream";

/** Wait after a size change before the watch starts again at the new phone grid. */
const PHONE_RESIZE_MS = 400;

/** What the terminal view can ask of the xterm.js view. */
export type XtermHandle = { scrollToBottom(): void; scrollPages(n: number): void };

/** The page HTML for one terminal background (the theme of a new page). Built once per color. */
let pageCache: { bg: string; html: string } | undefined;
function pageHtml(bg: string): string {
  if (pageCache?.bg !== bg) pageCache = { bg, html: xtermHtml(loadXtermAssets(), bg) };
  return pageCache.html;
}

/**
 * A pane in a terminal emulator: xterm.js in a web view, fed by the raw stream of `pane.watch`
 * (`format: "vt"`). The web view loads lazily (`loadWebView`); without it, or when the host refuses
 * the format, `onUnsupported` tells the parent to show the classic view. The page never takes
 * the keyboard and never types into the pane: typing stays in the terminal controls.
 */
export function XtermView({
  hostId,
  paneId,
  enabled,
  mode,
  onDrive,
  search,
  onBuffer,
  onUnsupported,
  onTap,
  handleRef,
}: {
  hostId: string;
  paneId: string;
  /** False: no stream (the screen is not visible). */
  enabled: boolean;
  /** The shown width mode: "fit", "scroll" or "phone". */
  mode: WidthMode;
  onDrive?: (drive: boolean) => void;
  search?: { term: string; index: number; onCount: (n: number) => void };
  /** The page shows the alternate screen (a full-screen app), and whether it is at the end. */
  onBuffer?: (b: { alternate: boolean; atBottom: boolean }) => void;
  onUnsupported: () => void;
  onTap?: () => void;
  handleRef?: Ref<XtermHandle>;
}) {
  const WebView = loadWebView();
  const web = useRef<WebViewHandle>(null);
  const outbox = useRef(OUTBOX_START);
  const [pageKey, setPageKey] = useState(0);
  const [ratio, setRatio] = useState<CellRatio | null>(null);
  const [view, setView] = useState({ width: 0, height: 0 });
  const [pane, setPane] = useState<{ cols: number; rows: number }>();
  const restartRef = useRef<() => void>(() => {});
  // Counts the pages that said `ready`: a new page gets the open search again.
  const [readyCount, setReadyCount] = useState(0);

  const post = (msg: ToWeb) => {
    const s = outboxReducer(outbox.current, { type: "send", msg });
    outbox.current = s.box;
    s.post.forEach((p) => web.current?.postMessage(p));
    if (s.restart) restartRef.current();
  };
  const postRef = useRef(post);
  postRef.current = post;

  const base = type.size.caption;
  const layout = xtermLayout({ mode, width: view.width, height: view.height, ratio, pane, base });
  const driveKey = useDebounced(layout.drive ? `${layout.drive.cols}x${layout.drive.rows}` : "", PHONE_RESIZE_MS);
  const size = useMemo(() => {
    const [c, r] = driveKey.split("x").map(Number);
    return mode === "phone" && c && r ? { cols: c, rows: r } : undefined;
  }, [driveKey, mode]);
  // Phone width waits for the grid of the view, so the first attach is already at that size.
  const waitGrid = mode === "phone" && !size;

  const { phase, error, restart } = useVtStream(hostId, paneId, enabled && !!WebView && !waitGrid, { size, onDrive }, (m) => {
    if (m.type === "reset" || m.type === "resize") setPane({ cols: m.cols, rows: m.rows });
    postRef.current(m);
  });
  restartRef.current = restart;

  useEffect(() => {
    if (!WebView || phase === "unsupported") onUnsupported();
  }, [WebView, phase, onUnsupported]);

  const theme = useMemo(() => xtermTheme(colors), []);
  const fontSize = layout.fontSize;
  useEffect(() => postRef.current({ type: "font", size: fontSize }), [fontSize]);

  // Search: one search addon call per change of the box or of the current match.
  const lastSearch = useRef<SearchState | undefined>(undefined);
  const searchCount = useRef(0);
  const term = search?.term ?? "";
  const index = search?.index ?? -1;
  useEffect(() => {
    const next = { term, index };
    const op = searchOp(lastSearch.current, next, searchCount.current);
    lastSearch.current = next;
    if (!op) return;
    postRef.current({ type: "search", term, dir: op, ...(op === "clear" ? {} : { decorations: searchDecorations(colors) }) });
  }, [term, index, readyCount]);

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToBottom: () => postRef.current({ type: "scrollToBottom" }),
      scrollPages: (n: number) => postRef.current({ type: "scrollPages", n }),
    }),
    [],
  );

  const onCount = search?.onCount;
  const onMessage = (raw: string) => {
    const m = parseFromWeb(raw);
    if (!m) return;
    switch (m.type) {
      case "ready": {
        const s = outboxReducer(outbox.current, { type: "ready" });
        outbox.current = s.box;
        // A new page has no theme or font yet: they go first.
        web.current?.postMessage(JSON.stringify({ type: "theme", theme }));
        web.current?.postMessage(JSON.stringify({ type: "font", size: fontSize }));
        s.post.forEach((p) => web.current?.postMessage(p));
        if (s.restart) restart();
        // A search that was open before the page was ready runs again.
        lastSearch.current = undefined;
        setReadyCount((n) => n + 1);
        break;
      }
      case "metrics":
        setRatio((r) => {
          const n = cellRatio(m);
          return r && n && Math.abs(r.w - n.w) < 1e-6 && Math.abs(r.h - n.h) < 1e-6 ? r : n;
        });
        setView((v) => (v.width === m.width && v.height === m.height ? v : { width: m.width, height: m.height }));
        break;
      case "buffer":
        onBuffer?.({ alternate: m.alternate, atBottom: m.atBottom });
        break;
      case "search":
        searchCount.current = m.count;
        onCount?.(m.count);
        break;
      case "tap":
        onTap?.();
        break;
      case "text":
        openSelectText({ title: "Terminal", text: m.text });
        break;
      case "error":
        if (__DEV__) console.warn("terminal page:", m.message);
        break;
    }
  };

  /** The page ended (the web content process stopped): a new page and a new stream. */
  const reload = () => {
    outbox.current = outboxReducer(outbox.current, { type: "unload" }).box;
    setPageKey((k) => k + 1);
    restart();
  };

  if (!WebView) return null;
  const html = pageHtml(colors.terminal.bg);
  return (
    <View style={{ flex: 1, backgroundColor: colors.terminal.bg, padding: space.sm }}>
      <WebView
        key={pageKey}
        ref={web}
        source={{ html }}
        style={{ flex: 1, backgroundColor: colors.terminal.bg }}
        originWhitelist={["about:*"]}
        onShouldStartLoadWithRequest={(req) => req.url.startsWith("about:")}
        onMessage={(e) => onMessage(e.nativeEvent.data)}
        onContentProcessDidTerminate={reload}
        onRenderProcessGone={reload}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction
        textInteractionEnabled={false}
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        setSupportMultipleWindows={false}
        webviewDebuggingEnabled={__DEV__}
        accessibilityLabel="Terminal screen"
      />
      {!pane || phase === "failed" ? (
        <View pointerEvents="none" style={{ position: "absolute", top: space.md, left: space.md, right: space.md }}>
          {/* `terminal.fg`, not `textMuted`: the terminal theme can be light. */}
          <Text mono variant="caption" color={colors.terminal.fg}>
            {phase === "failed" && error ? `Can't read the terminal: ${error}` : "Loading…"}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
