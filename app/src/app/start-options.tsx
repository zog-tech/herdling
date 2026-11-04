import { useLocalSearchParams, useRouter } from "expo-router";

import type { SheetFocus } from "@/newSession/StartOptionsBar";
import { StartOptionsSheet } from "@/newSession/StartOptionsSheet";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

/** The start options sheet of New session and the restart screen (a native form sheet). `focus` focuses one field. */
export default function StartOptionsScreen() {
  const { kind, focus } = useLocalSearchParams<{ kind: string; focus?: string }>();
  const router = useRouter();
  const field: SheetFocus | undefined = focus === "model" || focus === "extra" ? focus : undefined;
  return <StartOptionsSheet kind={kind ?? ""} focus={field} onClose={() => router.back()} />;
}
