import { useRouter } from "expo-router";
import { Plus, Trash2 } from "lucide-react-native";
import { View } from "react-native";

import { ConnBadge, timeAgo } from "@/hosts/ConnBadge";
import { useHostConn } from "@/hosts/connection";
import { confirmRemoveHost } from "@/hosts/removeHost";
import { useHosts, type Host } from "@/hosts/store";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

function HostRow({ host }: { host: Host }) {
  const router = useRouter();
  const conn = useHostConn(host.id);
  return (
    <Row
      accessibilityLabel={`Edit ${host.name}`}
      onPress={() => router.push({ pathname: "/hosts/[id]", params: { id: host.id } })}
      trailing={<Button label={`Remove ${host.name}`} iconOnly variant="danger" Icon={Trash2} onPress={() => confirmRemoveHost(host)} />}
    >
      <Text bold>{host.name}</Text>
      <Text variant="small" muted mono>
        {host.user}@{host.address}
        {host.port === 22 ? "" : `:${host.port}`}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs }}>
        <ConnBadge status={conn.status} />
        {conn.lastSeen ? (
          <Text variant="caption" muted>
            Seen {timeAgo(conn.lastSeen)}
          </Text>
        ) : null}
      </View>
    </Row>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const hosts = useHosts((s) => s.hosts);
  return (
    <Screen>
      <Text variant="small" muted>
        HOSTS
      </Text>
      <Card style={{ paddingVertical: space.sm }}>
        {hosts.length === 0 ? (
          <Text muted style={{ paddingVertical: space.md }}>
            No hosts yet. Add one to get started.
          </Text>
        ) : (
          hosts.map((h, i) => (
            <View
              key={h.id}
              style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.muted, paddingTop: space.sm } : undefined}
            >
              <HostRow host={h} />
            </View>
          ))
        )}
      </Card>
      <Button label="Add host" Icon={Plus} onPress={() => router.push("/hosts/discover")} />
    </Screen>
  );
}
