import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ArrowRight, Copy, ExternalLink, Lock, RotateCw, TriangleAlert, X } from "lucide-react-native";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Linking, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { loadWebView, type WebViewHandle } from "@/preview/webview";
import { linkTarget } from "@/thread/links";
import { colors, icon, space } from "@/theme/tokens";
import { copyIfAvailable, hasClipboard } from "@/ui/clipboard";
import * as haptics from "@/ui/haptics";
import { DelayedSpinner } from "@/ui/Delayed";
import { showNotice } from "@/ui/notice";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";
import { ToolButton } from "@/ui/ToolButton";

/** Schemes that a page may hand to the system: mail, phone and text messages. */
const SYSTEM_SCHEMES = /^(mailto|tel|sms):/i;

/**
 * True when the web view may load `url` in place: web pages and the blank, data and blob pages.
 * A loopback URL is blocked: on the phone it is the phone itself, not the user's computer.
 */
function loadsInPlace(url: string): boolean {
  if (/^(about|data|blob):/i.test(url)) return true;
  return linkTarget(url)?.kind === "web";
}

/** The address bar text: the URL without `https://` or `http://`. */
const addressText = (url: string) => url.replace(/^https?:\/\//i, "");

/**
 * Screen: the in-app browser for a link in the thread (`url` search param). A web view with a
 * toolbar: Close, the address, Copy link, Back, Forward, Reload and Open in Safari. Builds without
 * the web view show a notice; the thread opens the system browser for them.
 */
export default function BrowserScreen() {
  const { url: urlParam } = useLocalSearchParams<{ url?: string }>();
  const start = typeof urlParam === "string" && linkTarget(urlParam)?.kind === "web" ? urlParam : undefined;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const WebView = loadWebView();
  const web = useRef<WebViewHandle>(null);
  const [nav, setNav] = useState({ url: start ?? "", back: false, forward: false, loading: true });
  const [loadError, setLoadError] = useState<string>();
  const close = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/")), [router]);
  const shown = nav.url || start || "";
  const systemLabel = Platform.OS === "ios" ? "Open in Safari" : "Open in browser";
  const openSystem = () => {
    if (shown) Linking.openURL(shown).catch(() => {});
  };

  let body: ReactNode;
  if (!start) {
    body = (
      <Centered>
        <StateNotice Icon={TriangleAlert} message="This link cannot open here." />
      </Centered>
    );
  } else if (!WebView) {
    body = (
      <Centered>
        <StateNotice Icon={TriangleAlert} message="This app build cannot show web pages." action={systemLabel} onAction={openSystem} />
      </Centered>
    );
  } else {
    body = (
      <View style={{ flex: 1 }}>
        <WebView
          ref={web}
          source={{ uri: start }}
          style={{ flex: 1, backgroundColor: colors.bg }}
          originWhitelist={["http://*", "https://*", "about:*", "data:*", "blob:*"]}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          sharedCookiesEnabled
          webviewDebuggingEnabled={__DEV__}
          onShouldStartLoadWithRequest={(req) => {
            if (loadsInPlace(req.url)) return true;
            if (SYSTEM_SCHEMES.test(req.url)) Linking.openURL(req.url).catch(() => {});
            return false;
          }}
          onNavigationStateChange={(s) => setNav({ url: s.url, back: s.canGoBack, forward: s.canGoForward, loading: s.loading })}
          onLoadStart={() => setLoadError(undefined)}
          onError={(e) => setLoadError(e.nativeEvent.description || "the page did not load")}
        />
        {loadError ? (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, padding: space.lg, backgroundColor: colors.card }}>
            <StateNotice
              Icon={TriangleAlert}
              color={colors.status.blocked}
              message={`The page did not load: ${loadError}`}
              action="Reload"
              onAction={() => web.current?.reload()}
            />
          </View>
        ) : null}
      </View>
    );
  }

  const ready = !!start && !!WebView;
  const secure = /^https:/i.test(shown);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <ToolButton label="Close browser" Icon={X} onPress={close} />
        <View accessible accessibilityLabel={`Address ${shown}`} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm }}>
          {secure ? <Lock size={icon.sm} color={colors.textMuted} /> : null}
          <Text mono variant="small" numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1 }}>
            {addressText(shown)}
          </Text>
          {ready && nav.loading ? <DelayedSpinner color={colors.textMuted} /> : null}
        </View>
        {shown && hasClipboard() ? (
          <ToolButton
            label="Copy link"
            Icon={Copy}
            onPress={() => {
              if (copyIfAvailable(shown)) {
                haptics.tap();
                showNotice("Link copied");
              }
            }}
          />
        ) : null}
      </View>
      {body}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-around",
          paddingBottom: insets.bottom,
          borderTopWidth: 1,
          borderTopColor: colors.divider,
          backgroundColor: colors.bg,
        }}
      >
        <ToolButton label="Back" Icon={ArrowLeft} disabled={!ready || !nav.back} onPress={() => web.current?.goBack()} />
        <ToolButton label="Forward" Icon={ArrowRight} disabled={!ready || !nav.forward} onPress={() => web.current?.goForward()} />
        <ToolButton
          label="Reload"
          Icon={RotateCw}
          disabled={!ready}
          onPress={() => {
            haptics.tap();
            web.current?.reload();
          }}
        />
        <ToolButton label={systemLabel} Icon={ExternalLink} disabled={!shown} onPress={openSystem} />
      </View>
    </View>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>{children}</View>;
}
