import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useRouter } from "expo-router";
import { Camera, Settings } from "lucide-react-native";
import { useRef, useState } from "react";
import { Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { parsePairUrl } from "@/pairing/pairUrl";
import { Lead } from "@/hosts/flowParts";
import { colors, radius, space } from "@/theme/tokens";
import { ActionBar } from "@/ui/ActionBar";
import { Section } from "@/ui/Group";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Scans the QR code of herdlingd pair and returns to the pair screen with its values. */
export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();
  const [wrong, setWrong] = useState(false);
  const done = useRef(false);

  const onScan = ({ data }: BarcodeScanningResult) => {
    if (done.current) return;
    const target = parsePairUrl(data);
    if (!target) {
      setWrong(true);
      return;
    }
    done.current = true;
    router.dismissTo({
      pathname: "/hosts/pair",
      params: {
        address: target.address,
        port: String(target.port),
        code: target.code,
        ...(target.fingerprint ? { fingerprint: target.fingerprint } : {}),
        ...(target.requireV2 ? { v: "2" } : {}),
      },
    });
  };

  if (!permission) return <Screen>{null}</Screen>;

  if (!permission.granted) {
    const footer = permission.canAskAgain ? (
      <ActionBar primary={{ label: "Allow camera", Icon: Camera, onPress: () => void requestPermission() }} />
    ) : (
      <ActionBar primary={{ label: "Open Settings", Icon: Settings, onPress: () => Linking.openSettings() }} />
    );
    return (
      <Screen flush footer={footer}>
        <Section title="Camera access">
          <Lead>Herdling uses the camera only to scan the pairing QR code that herdlingd pair shows.</Lead>
        </Section>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg, paddingBottom: space.lg + insets.bottom, gap: space.lg }}>
      <View style={{ flex: 1, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.sunken }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScan}
          accessibilityLabel="Camera viewfinder"
        />
      </View>
      <Text muted={!wrong} color={wrong ? colors.status.blocked : undefined} accessibilityLiveRegion="polite">
        {wrong ? "Not a Herdling pairing code. Scan the QR code from herdlingd pair." : "Point the camera at the QR code from herdlingd pair."}
      </Text>
    </View>
  );
}
