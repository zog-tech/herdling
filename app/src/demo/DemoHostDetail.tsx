import { Trash2 } from "lucide-react-native";
import { View } from "react-native";

import { connLabel, ConnStatus } from "@/hosts/ConnBadge";
import { useHostConn } from "@/hosts/connection";
import { confirmRemoveHost } from "@/hosts/removeHost";
import type { Host } from "@/hosts/store";
import { colors, icon, space } from "@/theme/tokens";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";

import { DemoTag } from "./DemoTag";

/** The detail screen of the demo host: what the demo is, what is not real, and "Remove demo". */
export function DemoHostDetail({ host, onRemoved }: { host: Host; onRemoved: () => void }) {
  const conn = useHostConn(host.id);
  return (
    <Screen flush>
      <Section title="Demo">
        <Group>
          <Row
            accessibilityLabel={`${host.name}, demo host, ${connLabel(conn.status)}`}
            title={host.name}
            detail="Sample agents that run inside this app. No computer, network or account is used."
            trailing={
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <DemoTag />
                <ConnStatus status={conn.status} />
              </View>
            }
          />
          <Row
            title="What you can do"
            detail="Open the agents, answer the agent that needs you, send messages, start a new session, and look at the terminal, usage and automations."
          />
          <Row
            title="What is not real"
            detail="The replies are scripted and no files change. The demo starts again each time you open the app. To use your own agents, add a computer that runs herdlingd."
          />
        </Group>
      </Section>
      <Section>
        <Group>
          <Row
            accessibilityLabel="Remove demo"
            accessibilityHint="Removes the demo computer and its sample agents"
            onPress={() => confirmRemoveHost(host, onRemoved)}
            leading={<Trash2 size={icon.md} color={colors.danger} strokeWidth={icon.strokeWidth} />}
            title="Remove demo"
            destructive
          />
        </Group>
      </Section>
    </Screen>
  );
}
