import { useLocalSearchParams, useRouter } from "expo-router";

import { StartOptionsSheet } from "@/newSession/StartOptionsSheet";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

/** The start options sheet of New session and the restart screen (a native form sheet). */
export default function StartOptionsScreen() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const router = useRouter();
  return <StartOptionsSheet kind={kind ?? ""} onClose={() => router.back()} />;
}
