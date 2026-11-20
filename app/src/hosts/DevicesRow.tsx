import { useRouter } from "expo-router";

import { useMirrorSupported } from "@/mirror/useMirror";
import { Card } from "@/ui/Card";
import { Row } from "@/ui/Row";

/**
 * The "Simulators" row of the host screen: it opens the iOS simulators and Android emulators of
 * the computer. It shows only when the host and the build have the device mirror.
 */
export function DevicesRow({ hostId }: { hostId: string }) {
  const router = useRouter();
  const supported = useMirrorSupported(hostId);
  if (!supported) return null;
  return (
    <Card>
      <Row
        title="Simulators"
        detail="See and use an iOS simulator or Android emulator"
        chevron
        accessibilityHint="Lists the simulators and emulators of this computer"
        onPress={() => router.push(`/devices/${encodeURIComponent(hostId)}` as never)}
      />
    </Card>
  );
}
