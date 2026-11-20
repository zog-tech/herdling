import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, House, Keyboard, Lock, RotateCw, SendHorizontal, Square, TriangleAlert, X } from "lucide-react-native";
import { useRef, useState, type ReactNode } from "react";
import { Linking, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { DevicePlatform } from "@herdling/protocol";

import { validDeviceId } from "@/mirror/devices";
import { keyCommand, parsePageMessage, rotateCommand, statusLine, textCommand, toolbarKeys, type MirrorKey, type PageState } from "@/mirror/page";
import { mirrorUrl, staysInMirror } from "@/mirror/tunnel";
import { useMirror, useMirrorSupported } from "@/mirror/useMirror";
import { loadWebView, type WebViewHandle } from "@/preview/webview";
import { colors, radius, space, type as typeScale } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import * as haptics from "@/ui/haptics";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";
import { ToolButton } from "@/ui/ToolButton";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

const KEY_ICONS: Record<MirrorKey, typeof X> = {
  home: House,
  back: ArrowLeft,
  app_switch: Square,
  lock: Lock,
  volume_up: Square,
  volume_down: Square,
};

/**
 * Screen: an iOS simulator or an Android emulator of the computer. herdlingd serves a player page
 * on a loopback port; the page comes through the preview tunnel and shows the device as video.
 * Touches on the page go to the device. The toolbar sends keys and text with `postMessage`.
 */
export default function MirrorScreen() {
  const params = useLocalSearchParams<{ hostId: string; device: string; name?: string; platform?: string }>();
  const { hostId } = params;
  const device = validDeviceId(params.device) ? params.device : undefined;
  const platform: DevicePlatform = params.platform === "ios" ? "ios" : "android";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const supported = useMirrorSupported(hostId);
  const WebView = loadWebView();
  const { tunnel, retry } = useMirror(hostId, device ?? "");
  const web = useRef<WebViewHandle>(null);
  const [page, setPage] = useState<PageState>();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const sendToPage = (m: string | undefined) => {
    if (!m) return;
    haptics.tap();
    web.current?.postMessage(m);
  };
  const sendText = () => {
    const m = textCommand(text);
    if (!m) return;
    sendToPage(m);
    setText("");
  };

  const ready = tunnel.phase === "ready";
  const input = ready && page?.input === true;

  let body: ReactNode;
  if (!device || !supported || !WebView) {
    body = (
      <Centered>
        <StateNotice Icon={TriangleAlert} message="The device mirror needs a newer app build and herdlingd on this computer." />
      </Centered>
    );
  } else if (tunnel.phase === "error") {
    body = (
      <Centered>
        <StateNotice Icon={TriangleAlert} color={colors.status.blocked} message={`Can't open the device: ${tunnel.message}`} action="Retry" onAction={retry} />
      </Centered>
    );
  } else if (tunnel.phase === "paused" || tunnel.phase === "closed") {
    body = (
      <Centered>
        <Text muted>The mirror is paused while the app is in the background or offline.</Text>
      </Centered>
    );
  } else if (tunnel.phase !== "ready") {
    body = (
      <Centered>
        <DelayedSpinner color={colors.textMuted} />
      </Centered>
    );
  } else {
    const { localPort, start } = tunnel;
    body = (
      <WebView
        // A new tunnel loads the page again on the new listener.
        key={`${tunnel.started}`}
        ref={web}
        source={{ uri: mirrorUrl(localPort, start.path) }}
        style={{ flex: 1, backgroundColor: colors.sunken }}
        originWhitelist={["http://*", "about:*"]}
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        allowsInlineMediaPlayback
        webviewDebuggingEnabled={__DEV__}
        onShouldStartLoadWithRequest={(req) => {
          if (staysInMirror(req.url, localPort, start.path)) return true;
          if (/^https?:\/\//.test(req.url)) void Linking.openURL(req.url);
          return false;
        }}
        onMessage={(e) => {
          const s = parsePageMessage(e.nativeEvent.data);
          if (s) setPage(s);
        }}
      />
    );
  }

  const note = ready ? statusLine(page) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.sunken, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.bg }}>
        <ToolButton label="Close device" Icon={X} onPress={close} />
        <View style={{ flex: 1, paddingHorizontal: space.sm }}>
          <Text variant="small" numberOfLines={1}>
            {params.name || device || "Device"}
          </Text>
          {note ? (
            <Text variant="caption" muted numberOfLines={1} accessibilityLiveRegion="polite">
              {note}
            </Text>
          ) : null}
        </View>
        {ready && !page ? <DelayedSpinner color={colors.textMuted} /> : null}
      </View>
      <View style={{ flex: 1 }}>{body}</View>
      {typing ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.divider }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Text for the device"
            placeholderTextColor={colors.textMuted}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={sendText}
            maxLength={1000}
            accessibilityLabel="Text for the device"
            style={{
              flex: 1,
              color: colors.text,
              fontSize: typeScale.size.body,
              backgroundColor: colors.card,
              borderRadius: radius.md,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
            }}
          />
          <ToolButton label="Send text" Icon={SendHorizontal} disabled={!input || text.length === 0} onPress={sendText} />
        </View>
      ) : null}
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
        {toolbarKeys(platform).map((k) => (
          <ToolButton key={k.key} label={k.label} Icon={KEY_ICONS[k.key]} disabled={!input} onPress={() => sendToPage(keyCommand(k.key))} />
        ))}
        {platform === "android" ? <ToolButton label="Rotate" Icon={RotateCw} disabled={!input} onPress={() => sendToPage(rotateCommand())} /> : null}
        <ToolButton label={typing ? "Hide the text field" : "Type text"} Icon={Keyboard} disabled={!input} onPress={() => setTyping((t) => !t)} />
      </View>
    </View>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>{children}</View>;
}
