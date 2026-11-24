import Constants from "expo-constants";
import * as Updates from "expo-updates";

import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";

/** The app version from the build, for example "1.0.0". The value of the About row. */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? "?";
}

/** "1.0.0 · update 488f5e09, Oct 31" or "1.0.0 · built-in code". Tells which code the phone runs. */
export function versionText(): string {
  const version = appVersion();
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return `${version} · built-in code`;
  const day = Updates.createdAt ? `, ${Updates.createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "";
  return `${version} · update ${Updates.updateId.slice(0, 8)}${day}`;
}

/** More, "About": the version and the code that the phone runs. */
export function AboutPage() {
  return (
    <Screen flush>
      <Section>
        <Group>
          <Row title="Version" detail={versionText()} />
        </Group>
      </Section>
    </Screen>
  );
}
