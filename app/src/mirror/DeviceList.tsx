import type { DevicesList, MirrorDevice } from "@herdling/protocol";
import { Smartphone } from "lucide-react-native";
import { View } from "react-native";

import { colors, icon, space } from "@/theme/tokens";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

import { deviceDetail, emptyMessage, offeredDevices, toolHints } from "./devices";

/**
 * The simulators and emulators of one computer (`devices.list`), with hints for missing tools.
 * A tap opens the mirror of the device. Real devices are not offered.
 */
export function DeviceList({ list, macos, onOpen }: { list: DevicesList; macos: boolean; onOpen: (d: MirrorDevice) => void }) {
  const { devices, hidden } = offeredDevices(list.devices);
  const hints = toolHints(list.tools, macos);
  const ios = devices.filter((d) => d.platform === "ios");
  const android = devices.filter((d) => d.platform === "android");
  const row = (d: MirrorDevice) => (
    <Row
      key={d.id}
      title={d.name}
      detail={deviceDetail(d)}
      leading={<Smartphone size={icon.md} color={d.mirroring ? colors.accent : colors.textMuted} />}
      chevron
      accessibilityLabel={`${d.name}, ${deviceDetail(d)}${d.mirroring ? ", mirror open" : ""}`}
      accessibilityHint="Shows the screen of the device"
      onPress={() => onOpen(d)}
    />
  );
  return (
    <>
      {devices.length === 0 ? (
        <StateNotice Icon={Smartphone} message={emptyMessage(hidden)} />
      ) : null}
      {ios.length > 0 ? (
        <Section title="iOS simulators">
          <Group>{ios.map(row)}</Group>
        </Section>
      ) : null}
      {android.length > 0 ? (
        <Section title="Android emulators" footer={hidden > 0 && devices.length > 0 ? emptyHiddenNote(hidden) : undefined}>
          <Group>{android.map(row)}</Group>
        </Section>
      ) : null}
      {hints.length > 0 ? (
        <View style={{ paddingHorizontal: space.lg, gap: space.xs }}>
          {hints.map((h) => (
            <Text key={h} variant="small" muted>
              {h}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}

function emptyHiddenNote(hidden: number): string {
  return hidden === 1 ? "1 real device is not shown." : `${hidden} real devices are not shown.`;
}
