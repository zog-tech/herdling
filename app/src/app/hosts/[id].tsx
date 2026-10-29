import { useLocalSearchParams } from "expo-router";

import { HostForm } from "@/hosts/HostForm";
import { useHosts } from "@/hosts/store";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export default function EditHostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const host = useHosts((s) => s.hosts.find((h) => h.id === id));
  if (!host)
    return (
      <Screen>
        <Text muted>Host not found.</Text>
      </Screen>
    );
  return <HostForm key={host.id} host={host} />;
}
