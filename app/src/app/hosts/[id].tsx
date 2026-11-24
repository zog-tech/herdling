import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { CircleAlert } from "lucide-react-native";

import { DemoHostDetail } from "@/demo/DemoHostDetail";
import { isDemoHost } from "@/demo/demoHost";
import { HostForm } from "@/hosts/HostForm";
import { useHosts } from "@/hosts/store";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";

export default function EditHostScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const host = useHosts((s) => s.hosts.find((h) => h.id === id));
  if (!host)
    return (
      <Screen>
        <StateNotice Icon={CircleAlert} message="Computer not found." />
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
  // The title is the name of the computer. "Remove" is the last row of the screen, as on the demo host.
  return (
    <>
      <Stack.Screen options={{ title: host.name }} />
      <HostForm key={host.id} host={host} />
    </>
  );
}
