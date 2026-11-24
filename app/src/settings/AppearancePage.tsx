import { AppearanceSection } from "@/board/AppearanceSection";
import { Screen } from "@/ui/Screen";

/** More, "Appearance": the theme (its own screen), the top of the Agents tab and the agent list style. */
export function AppearancePage() {
  return (
    <Screen flush>
      <AppearanceSection />
    </Screen>
  );
}
