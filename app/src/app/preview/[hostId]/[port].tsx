import { requireOptionalNativeModule } from "expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ArrowRight, Copy, Globe, RotateCw, TriangleAlert, X } from "lucide-react-native";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { demoPreviewHtml } from "@/demo/demoPreview";
import { isDemoHost } from "@/demo/demoHost";
import { addressText, deskUrl, localUrl, staysInPreview, validPort } from "@/preview/preview";
import { usePreviewSupported, useTunnel } from "@/preview/usePreview";
import { loadWebView, type WebViewHandle } from "@/preview/webview";
import { colors, hitTarget, icon, space, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { DelayedSpinner } from "@/ui/Delayed";
import { showNotice } from "@/ui/notice";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

/** A 44 pt icon button of the toolbar. */
function ToolButton({ label, Icon, onPress, disabled }: { label: string; Icon: typeof X; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={2}
      style={({ pressed }) => ({
        width: hitTarget,
        height: hitTarget,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? state.disabledOpacity : pressed ? state.pressedOpacity : 1,
      })}
    >
      <Icon size={icon.md} color={colors.text} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}

/** Copies text when the build has the clipboard module. Older builds do not show the button. */
function copyText(text: string): boolean {
  if (requireOptionalNativeModule("ExpoClipboard") == null) return false;
  const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
  void Clipboard.setStringAsync(text);
  return true;
}

/**
 * Screen: a dev server of the computer in a web view. The native ssh module serves the page on a
 * loopback port of the phone and sends each connection over its own SSH channel to the computer.
 * The demo host shows a static page.
 */
export default function PreviewScreen() {
  const { hostId, port: portParam } = useLocalSearchParams<{ hostId: string; port: string }>();
  const port = Number(portParam);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const supported = usePreviewSupported(hostId);
  const demo = isDemoHost(hostId);
  const WebView = loadWebView();
  const [retry, setRetry] = useState(0);
  const tunnel = useTunnel(hostId, validPort(port) ? port : 0, retry);
  const web = useRef<WebViewHandle>(null);
  const [nav, setNav] = useState({ url: "", back: false, forward: false, loading: true });
  const [loadError, setLoadError] = useState<string>();

  const localPort = tunnel.phase === "ready" ? tunnel.localPort : undefined;
  const shownUrl = nav.url || (localPort !== undefined ? localUrl(localPort) : `http://localhost:${port}/`);
  const close = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/")), [router]);

  let body: ReactNode;
  if (!validPort(port) || !supported || !WebView) {
    body = (
      <Centered>
        <StateNotice Icon={TriangleAlert} message="Browser preview needs a newer app build and herdlingd on this computer." />
      </Centered>
    );
  } else if (tunnel.phase === "error") {
    body = (
      <Centered>
        <StateNotice
          Icon={TriangleAlert}
          color={colors.status.blocked}
          message={`Can't open port ${port}: ${tunnel.message}`}
          action="Retry"
          onAction={() => setRetry((n) => n + 1)}
        />
      </Centered>
    );
  } else if (tunnel.phase === "paused") {
    body = (
      <Centered>
        <Text muted>Preview paused while the app is in the background.</Text>
      </Centered>
    );
  } else if (tunnel.phase === "starting") {
    body = (
      <Centered>
        <DelayedSpinner color={colors.textMuted} />
      </Centered>
    );
  } else {
    const source = demo ? { html: demoPreviewHtml(port) } : { uri: localUrl(localPort ?? port) };
    body = (
      <View style={{ flex: 1 }}>
        <WebView
          // A new key after a restart of the tunnel: the page loads again on the new listener.
          key={`${tunnel.started}`}
          ref={web}
          source={source}
          style={{ flex: 1, backgroundColor: colors.bg }}
          originWhitelist={["http://*", "about:*"]}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          webviewDebuggingEnabled={__DEV__}
          onShouldStartLoadWithRequest={(req) => {
            if (demo || staysInPreview(req.url, localPort)) return true;
            // Links to other sites open in the system browser, never through the computer.
            if (/^https?:\/\//.test(req.url)) void Linking.openURL(req.url);
            return false;
          }}
          onNavigationStateChange={(s) => setNav({ url: s.url, back: s.canGoBack, forward: s.canGoForward, loading: s.loading })}
          onLoadStart={() => setLoadError(undefined)}
          onError={(e) => setLoadError(e.nativeEvent.description || "the page did not load")}
        />
        {loadError ? (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, padding: space.lg, backgroundColor: colors.card, gap: space.xs }}>
            <StateNotice
              Icon={TriangleAlert}
              color={colors.status.blocked}
              message={`The page did not load: ${loadError}`}
              action="Reload"
              onAction={() => web.current?.reload()}
            />
            <Text variant="caption" muted>
              {"If hot reload uses a fixed host or port (for example Vite server.hmr.clientPort), the page cannot reach it here."}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  const ready = tunnel.phase === "ready" && !!WebView;
  const desk = demo ? `http://localhost:${port}/` : deskUrl(shownUrl, localPort, port);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <ToolButton label="Close preview" Icon={X} onPress={close} />
        <View accessible accessibilityLabel={`Address ${desk}`} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm }}>
          <Globe size={icon.sm} color={colors.textMuted} />
          <Text mono variant="small" numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1 }}>
            {demo ? `localhost:${port}/` : addressText(shownUrl, localPort, port)}
          </Text>
          {ready && nav.loading ? <DelayedSpinner color={colors.textMuted} /> : null}
        </View>
        {requireOptionalNativeModule("ExpoClipboard") != null ? (
          <ToolButton
            label="Copy URL"
            Icon={Copy}
            onPress={() => {
              if (copyText(desk)) {
                haptics.tap();
                showNotice("URL copied");
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
          disabled={tunnel.phase === "starting"}
          onPress={() => {
            haptics.tap();
            if (tunnel.phase === "ready") web.current?.reload();
            else setRetry((n) => n + 1);
          }}
        />
      </View>
    </View>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>{children}</View>;
}
