import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Trash2 } from "lucide-react-native";

import { DemoHostDetail } from "@/demo/DemoHostDetail";
import { isDemoHost } from "@/demo/demoHost";
import { HostForm } from "@/hosts/HostForm";
import { confirmRemoveHost } from "@/hosts/removeHost";
import { useHosts } from "@/hosts/store";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export default function EditHostScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const host = useHosts((s) => s.hosts.find((h) => h.id === id));
  if (!host)
    return (
      <Screen>
        <Text muted>Host not found.</Text>
      </Screen>
    );
  // The demo host has no address, user or key to edit: it shows what it is and "Remove demo".
  if (isDemoHost(host))
    return (
      <>
        <Stack.Screen options={{ title: host.name }} />
        <DemoHostDetail host={host} onRemoved={() => router.back()} />
      </>
    );
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button
              label={`Remove ${host.name}`}
              iconOnly
              variant="danger"
              Icon={Trash2}
              onPress={() => confirmRemoveHost(host, () => router.back())}
            />
          ),
        }}
      />
      <HostForm key={host.id} host={host} />
    </>
  );
}
