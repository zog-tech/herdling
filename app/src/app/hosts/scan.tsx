import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useRouter } from "expo-router";
import { Camera, Settings } from "lucide-react-native";
import { useRef, useState } from "react";
import { Linking, View } from "react-native";

import { parsePairUrl } from "@/pairing/pairUrl";
import { colors, radius, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Scans the QR code of herdlingd pair and returns to the pair screen with its values. */
export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
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
      },
    });
  };

  if (!permission) return <Screen>{null}</Screen>;

  if (!permission.granted) {
    return (
      <Screen>
        <Card>
          <Text variant="title">Camera access</Text>
          <Text muted>Herdling uses the camera only to scan the pairing QR code that herdlingd pair shows.</Text>
          {permission.canAskAgain ? (
            <Button label="Allow camera" Icon={Camera} onPress={() => void requestPermission()} />
          ) : (
            <Button label="Open Settings" variant="secondary" Icon={Settings} onPress={() => Linking.openSettings()} />
          )}
        </Card>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.lg }}>
      <View style={{ flex: 1, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
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
