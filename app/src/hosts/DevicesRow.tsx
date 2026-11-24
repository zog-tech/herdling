import { useRouter } from "expo-router";
import { Smartphone } from "lucide-react-native";

import { useMirrorSupported } from "@/mirror/useMirror";
import { colors, icon } from "@/theme/tokens";
import { Row } from "@/ui/Row";

/**
 * The "Simulators" row of the host screen: it opens the iOS simulators and Android emulators of
 * the computer. It shows only when the host and the build have the device mirror
 * (`useMirrorSupported`). Put it in a `Group`.
 */
export function DevicesRow({ hostId }: { hostId: string }) {
  const router = useRouter();
  const supported = useMirrorSupported(hostId);
  if (!supported) return null;
  return (
    <Row
      title="Simulators"
      leading={<Smartphone size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
      detail="See and use an iOS simulator or Android emulator"
      chevron
      accessibilityHint="Lists the simulators and emulators of this computer"
      onPress={() => router.push(`/devices/${encodeURIComponent(hostId)}` as never)}
    />
  );
}
