import { Linking, Platform, Share } from "react-native";

import { hasWebView } from "@/preview/webview";
import { copyIfAvailable, hasClipboard } from "@/ui/clipboard";
import * as haptics from "@/ui/haptics";
import { showActionSheet } from "@/ui/nativeSheet";
import { showNotice } from "@/ui/notice";

import type { ThreadPane } from "./LiveToolContext";
import { browserHref, linkActionLabel, linkActions, linkTarget, linkText, previewHref, type LinkAction, type LinkTarget } from "./links";

/**
 * What a tap or a long press on a link in a thread does. The rules are in `links.ts`.
 * A web page opens in the in-app browser when the build has the web view, else in the system
 * browser. A dev server of the computer opens in the browser preview: the phone's browser cannot
 * reach it.
 */

/** Loaded on first use: the router module is large, and thread rows load this module. */
const router = () => (require("expo-router") as typeof import("expo-router")).router;
/** Loaded on first use: it loads the host connections and the ssh module. */
const preview = () => require("@/preview/usePreview") as typeof import("@/preview/usePreview");

const openSystem = (url: string) => {
  Linking.openURL(url).catch(() => {});
};

function openPreview(t: Extract<LinkTarget, { kind: "local" }>, pane: ThreadPane | null): void {
  if (!pane) {
    haptics.warn();
    showNotice("Open this link from the session", { failed: true });
    return;
  }
  if (!preview().previewSupportedNow(pane.hostId)) {
    haptics.warn();
    showNotice("Preview needs a newer app and herdlingd", { failed: true });
    return;
  }
  router().push(previewHref(pane.hostId, t.port, t.path) as never);
}

function openTarget(t: LinkTarget, pane: ThreadPane | null): void {
  switch (t.kind) {
    case "local":
      openPreview(t, pane);
      return;
    case "web":
      if (hasWebView()) router().push(browserHref(t.url) as never);
      else openSystem(t.url);
      return;
    case "mail":
      openSystem(t.url);
      return;
  }
}

/** Opens the link. A URL that the app does not open does nothing. */
export function openLink(url: string, pane: ThreadPane | null): void {
  const t = linkTarget(url);
  if (t) openTarget(t, pane);
}

function runLinkAction(a: LinkAction, t: LinkTarget, pane: ThreadPane | null): void {
  switch (a) {
    case "open":
      openTarget(t, pane);
      return;
    case "system":
      openSystem(t.url);
      return;
    case "copy":
      if (copyIfAvailable(linkText(t))) {
        haptics.commit();
        showNotice("Link copied");
      }
      return;
    case "share":
      Share.share({ message: linkText(t) }).catch(() => {});
      return;
  }
}

/** Opens the link menu: Open, Open in Safari, Copy link, Share. The URL is the title. */
export function openLinkMenu(url: string, pane: ThreadPane | null): void {
  const t = linkTarget(url);
  if (!t) return;
  const actions = linkActions(t, { webView: hasWebView(), canCopy: hasClipboard() });
  const options = [...actions.map((a) => linkActionLabel(a, t, Platform.OS)), "Cancel"];
  showActionSheet({ title: linkText(t), options, cancelButtonIndex: actions.length }, (i) => {
    const a = actions[i];
    if (a) runLinkAction(a, t, pane);
  });
}
