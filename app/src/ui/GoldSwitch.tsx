import { Switch } from "react-native";

import { colors } from "@/theme/tokens";

/** A native switch in the Night Watch colors: gold when on, the `edge` gray when off. */
export function GoldSwitch({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: colors.edge, true: colors.accent }}
      ios_backgroundColor={colors.edge}
    />
  );
}
