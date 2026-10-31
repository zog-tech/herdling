import { useFocusEffect, useRouter } from "expo-router";
import { Settings, TriangleAlert } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Linking, View } from "react-native";

import { type Discovered, type DiscoveryState, knownHostFor, useDiscovery } from "@/hosts/discovery";
import { useHosts, type Host } from "@/hosts/store";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { Badge } from "@/ui/StatusBadge";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";
import { DelayedSpinner } from "@/ui/Delayed";

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
      title={d.name}
      trailing={known ? <Badge label="Paired" color={colors.status.done} /> : null}
      chevron={!!onPress}
    >
      <Text variant="small" muted mono={!!d.address}>
        {where}
      </Text>
    </Row>
  );
}

/** Browse state as text: searching, empty, local network denied or failed. */
function BrowseStatus({ state, onRetry }: { state: DiscoveryState; onRetry: () => void }) {
  const status = browseStatus(state, onRetry);
  return status ? <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>{status}</View> : null;
}

function browseStatus(state: DiscoveryState, onRetry: () => void) {
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
          Herdling needs it to find hosts. Turn on Local Network for Herdling in Settings.
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
      <StateNotice
        Icon={TriangleAlert}
        color={colors.danger}
        message={`Search failed${state.error ? `: ${state.error}` : "."}`}
        action="Retry"
        onAction={onRetry}
      />
    );
  }
  if (state.list.length > 0) return null;
  if (state.status === "ready") {
    return (
      <Text muted>
        No hosts found yet. Run herdlingd serve on your computer and keep this phone on the same network. No
        herdlingd yet? Use Set up with password below.
      </Text>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <DelayedSpinner color={colors.textMuted} />
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
  // Retry: stop the search for one frame, then start it again.
  const [paused, setPaused] = useState(false);
  const retry = useCallback(() => {
    setPaused(true);
    requestAnimationFrame(() => setPaused(false));
  }, []);
  const state = useDiscovery(focused && !paused);
  const hosts = useHosts((s) => s.hosts);

  return (
    <Screen flush>
      <Section title="On this network">
        <Group>
          {browseStatus(state, retry) ? <BrowseStatus state={state} onRetry={retry} /> : null}
          {state.list.map((d) => (
            <FoundRow key={d.name} d={d} known={knownHostFor(d, hosts)} />
          ))}
        </Group>
      </Section>

      <Section title="Other ways">
        <Group>
          <Row
            accessibilityLabel="Set up with password"
            onPress={() => router.push("/hosts/password")}
            title="Set up with password"
            detail="Log in once with the SSH password. Installs herdlingd when it is not there. Works over a VPN."
            chevron
          />
          <Row
            accessibilityLabel="Add by address"
            onPress={() => router.push("/hosts/pair")}
            title="Add by address"
            detail="Enter the address and the code from herdlingd pair."
            chevron
          />
          <Row
            accessibilityLabel="Add manually"
            onPress={() => router.push("/hosts/add")}
            title="Add manually"
            detail="Enter the SSH details and authorize the key yourself."
            chevron
          />
        </Group>
      </Section>
    </Screen>
  );
}
