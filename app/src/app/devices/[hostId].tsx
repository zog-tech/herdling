import { useLocalSearchParams, useRouter } from "expo-router";
import { CircleAlert, CloudOff, RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { RefreshControl, View } from "react-native";

import { useHostConn } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { mirrorRoute } from "@/mirror/devices";
import { DeviceList } from "@/mirror/DeviceList";
import { useDevices, useMirrorSupported } from "@/mirror/useMirror";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { DelayedSpinner } from "@/ui/Delayed";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

/** The iOS simulators and Android emulators of one computer. A tap opens the device mirror. */
export default function DevicesScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const router = useRouter();
  const hostName = useHosts((s) => s.hosts.find((h) => h.id === hostId)?.name ?? hostId);
  const { hello } = useHostConn(hostId);
  const supported = useMirrorSupported(hostId);
  const { state, reload } = useDevices(hostId);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  let body;
  if (!supported) {
    body = <StateNotice Icon={CircleAlert} message="The device mirror needs a newer app build and herdlingd on this computer." />;
  } else if (state.kind === "loading") {
    body = (
      <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <DelayedSpinner color={colors.textMuted} />
        <Text muted>Looking for simulators…</Text>
      </View>
    );
  } else if (state.kind === "offline") {
    body = <StateNotice Icon={CloudOff} message={`${hostName} is offline. Connect it to see its simulators.`} />;
  } else if (state.kind === "error") {
    body = (
      <StateNotice Icon={CircleAlert} color={colors.danger} message={`Can't list the devices: ${state.message}`} action="Retry" onAction={() => void reload()} />
    );
  }

  return (
    <Screen flush refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.textMuted} />}>
      {body ? (
        <View style={{ paddingHorizontal: space.lg }}>{body}</View>
      ) : state.kind === "ready" ? (
        <>
          <DeviceList
            list={state.list}
            macos={hello?.os === "macos"}
            onOpen={(d) => router.push(mirrorRoute(hostId, d) as never)}
          />
          <View style={{ paddingHorizontal: space.lg }}>
            <Button label="Refresh" variant="secondary" Icon={RefreshCw} onPress={() => void refresh()} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
