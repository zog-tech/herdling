import { Platform } from "react-native";

import { useNotifPrefs, type NotifPref } from "@/push/prefs";
import { GoldSwitch } from "@/ui/GoldSwitch";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";

/** Android has no push groups and no passive pushes: the row says so. */
const IOS_ONLY = Platform.OS === "ios" ? undefined : "Only on iPhone and iPad.";

function PrefRow({ pref, label, detail }: { pref: NotifPref; label: string; detail: string }) {
  const value = useNotifPrefs((s) => s[pref]);
  const setPref = useNotifPrefs((s) => s.setPref);
  return <Row title={label} detail={detail} trailing={<GoldSwitch label={label} value={value} onValueChange={(v) => setPref(pref, v)} />} />;
}

/** More, "Notifications": which pushes this phone wants, and how they show. */
export function NotificationsPage() {
  return (
    <Screen flush>
      <Section title="Send a push when">
        <Group>
          <PrefRow pref="finished" label="Finished" detail="An agent finished its turn." />
          <PrefRow pref="needs_you" label="Needs you" detail="An agent waits for your input." />
        </Group>
      </Section>
      <Section title="Delivery">
        <Group>
          <PrefRow
            pref="quiet_at_desk"
            label="Quiet at the computer"
            detail="No pushes while you use herdr on the computer, until 5 minutes after your last activity."
          />
          <PrefRow pref="replace" label="One notification per agent" detail="A new event replaces the old notification for the same agent." />
          <PrefRow pref="group" label="Group by computer" detail={IOS_ONLY ?? "Notifications from the same computer stay together."} />
          <PrefRow
            pref="quiet_finished"
            label="Deliver 'finished' quietly"
            detail={IOS_ONLY ?? "Finished notifications arrive without sound or banner."}
          />
        </Group>
      </Section>
    </Screen>
  );
}
