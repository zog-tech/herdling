import { useFocusEffect, useRouter } from "expo-router";
import { Check, ChevronRight, Keyboard, PenLine, Settings, TriangleAlert } from "lucide-react-native";
import { type ReactNode, useCallback, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";

import { type Discovered, type DiscoveryState, knownHostFor, useDiscovery } from "@/hosts/discovery";
import { useHosts, type Host } from "@/hosts/store";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { Badge } from "@/ui/StatusBadge";
import { Text } from "@/ui/Text";

function Divided({ children }: { children: ReactNode[] }) {
  return (
    <>
      {children.map((c, i) => (
        <View key={i} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.muted, paddingTop: space.sm } : undefined}>
          {c}
        </View>
      ))}
    </>
  );
}

function FoundRow({ d, known }: { d: Discovered; known?: Host }) {
  const router = useRouter();
  const where = d.address ? `${d.user ? `${d.user}@` : ""}${d.address}` : "Address not resolved";
  const onPress = known
    ? () => router.push({ pathname: "/hosts/[id]", params: { id: known.id } })
    : d.address
      ? () =>
          router.push({
            pathname: "/hosts/pair",
            params: { address: d.address!, port: String(d.pairPort), name: d.name },
          })
      : undefined;
  return (
    <Row
      accessibilityLabel={known ? `${d.name}, paired. Edit host` : `Pair with ${d.name}`}
      onPress={onPress}
      trailing={
        known ? (
          <Badge label="Paired" color={colors.status.idle} Icon={Check} />
        ) : onPress ? (
          <ChevronRight size={18} color={colors.textMuted} />
        ) : null
      }
    >
      <Text bold>{d.name}</Text>
      <Text variant="small" muted mono={!!d.address}>
        {where}
      </Text>
    </Row>
  );
}

/** Browse state as text: searching, empty, local network denied or failed. */
function BrowseStatus({ state }: { state: DiscoveryState }) {
  if (state.status === "waiting") {
    return (
      <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <TriangleAlert size={18} color={colors.status.blocked} />
          <Text bold color={colors.status.blocked}>
            Local network access is off
          </Text>
        </View>
        <Text variant="small" muted>
          Zogssh needs it to find hosts. Turn on Local Network for Zogssh in Settings.
        </Text>
        {state.error ? (
          <Text variant="caption" muted>
            {state.error}
          </Text>
        ) : null}
        <Button label="Open Settings" variant="secondary" Icon={Settings} onPress={() => Linking.openSettings()} />
      </View>
    );
  }
  if (state.status === "failed") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }} accessibilityLiveRegion="polite">
        <TriangleAlert size={18} color={colors.danger} />
        <Text color={colors.danger} style={{ flex: 1 }}>
          Search failed{state.error ? `: ${state.error}` : "."}
        </Text>
      </View>
    );
  }
  if (state.list.length > 0) return null;
  if (state.status === "ready") {
    return (
      <Text muted>
        No hosts found yet. Run zogsshd serve on your computer and keep this phone on the same network.
      </Text>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <ActivityIndicator color={colors.textMuted} />
      <Text muted>Searching the local network…</Text>
    </View>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const state = useDiscovery(focused);
  const hosts = useHosts((s) => s.hosts);

  return (
    <Screen>
      <Text variant="small" muted>
        ON THIS NETWORK
      </Text>
      <Card style={{ paddingVertical: space.sm }}>
        <BrowseStatus state={state} />
        {state.list.length > 0 ? (
          <Divided>
            {state.list.map((d) => (
              <FoundRow key={d.name} d={d} known={knownHostFor(d, hosts)} />
            ))}
          </Divided>
        ) : null}
      </Card>

      <Text variant="small" muted>
        OTHER WAYS
      </Text>
      <Card style={{ paddingVertical: space.sm }}>
        <Divided>
          {[
            <Row
              key="pair"
              accessibilityLabel="Add by address"
              onPress={() => router.push("/hosts/pair")}
              trailing={<ChevronRight size={18} color={colors.textMuted} />}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Keyboard size={18} color={colors.text} />
                <Text bold>Add by address</Text>
              </View>
              <Text variant="small" muted>
                Enter the address and the code from zogsshd pair.
              </Text>
            </Row>,
            <Row
              key="manual"
              accessibilityLabel="Add manually"
              onPress={() => router.push("/hosts/add")}
              trailing={<ChevronRight size={18} color={colors.textMuted} />}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <PenLine size={18} color={colors.text} />
                <Text bold>Add manually</Text>
              </View>
              <Text variant="small" muted>
                Enter the SSH details and authorize the key yourself.
              </Text>
            </Row>,
          ]}
        </Divided>
      </Card>
    </Screen>
  );
}
