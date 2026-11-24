import { GoldSwitch } from "@/ui/GoldSwitch";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import * as haptics from "@/ui/haptics";

/** More, "General": the Haptics switch. Off makes every haptic a no-op. Haptics stay on with Reduce Motion. */
export function GeneralPage() {
  const on = haptics.useFeelSettings((s) => s.haptics);
  const set = haptics.useFeelSettings((s) => s.set);
  return (
    <Screen flush>
      <Section title="Feel">
        <Group>
          <Row
            title="Haptics"
            detail="Taps you feel for send, approve, peek and status changes."
            trailing={
              <GoldSwitch
                label="Haptics"
                value={on}
                onValueChange={(v) => {
                  set({ haptics: v });
                  if (v) haptics.tap();
                }}
              />
            }
          />
        </Group>
      </Section>
    </Screen>
  );
}
