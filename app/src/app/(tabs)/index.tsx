import { Text, View } from "react-native";

import { colors, space, type } from "@/theme/tokens";

export default function OverviewScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}>
      <Text style={{ color: colors.textMuted, fontSize: type.size.body }}>Overview</Text>
    </View>
  );
}
