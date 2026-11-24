import { useRouter } from "expo-router";
import { Play, Plus } from "lucide-react-native";
import { View } from "react-native";

import { DemoTag } from "@/demo/DemoTag";
import { DEMO_HOST_DETAIL, isDemoHost, startDemo } from "@/demo/demoHost";
import { LOGIN_HINT, startsAtLogin } from "@/hosts/boot";
import { connLabel, ConnStatus, hostDetail } from "@/hosts/ConnBadge";
import { useHostConn } from "@/hosts/connection";
import { confirmRemoveHost } from "@/hosts/removeHost";
import { useHosts, type Host } from "@/hosts/store";
import { updateStatus } from "@/hosts/updates";
import { colors, icon, space } from "@/theme/tokens";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";

function HostRow({ host }: { host: Host }) {
  const router = useRouter();
  const conn = useHostConn(host.id);
  const demo = isDemoHost(host);
  const update = updateStatus(host, conn.status === "online" ? conn.hello : undefined);
  const updateText = update.kind === "available" ? `Update available: ${update.from} → ${update.to}` : undefined;
  const hello = conn.status === "online" ? conn.hello : undefined;
  // A quiet state line: herdr down first, then "starts after you log in".
  const stateText = demo || !hello ? undefined : !hello.herdr_ok ? "herdr is not running" : startsAtLogin(hello) ? LOGIN_HINT : undefined;
  const detailText = updateText ?? stateText;
  return (
    <Row
      accessibilityLabel={
        demo
          ? `${host.name}, demo host, ${connLabel(conn.status)}. Open demo`
          : `${host.name}, ${connLabel(conn.status)}${detailText ? `, ${detailText}` : ""}. Edit host`
      }
      accessibilityActions={[{ name: "remove", label: demo ? "Remove demo" : `Remove ${host.name}` }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "remove") void confirmRemoveHost(host);
      }}
      onPress={() => router.push({ pathname: "/hosts/[id]", params: { id: host.id } })}
      title={host.name}
      detail={demo ? DEMO_HOST_DETAIL : (detailText ?? hostDetail(host, conn.status, conn.lastSeen))}
      trailing={
        demo ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <DemoTag />
            <ConnStatus status={conn.status} />
          </View>
        ) : (
          <ConnStatus status={conn.status} />
        )
      }
      chevron
    />
  );
}

/**
 * More, "Computers": the saved computers, Add a computer and, with no computer, Try the demo. A tap on
 * a computer opens its edit screen. VoiceOver has a "remove" action on each row.
 */
export function ComputersPage() {
  const router = useRouter();
  const hosts = useHosts((s) => s.hosts);
  return (
    <Screen flush>
      <Section title="Computers">
        <Group>
          {hosts.length === 0 ? <Row title="No computers yet" detail="Add one to get started." /> : null}
          {hosts.map((h) => (
            <HostRow key={h.id} host={h} />
          ))}
        </Group>
      </Section>
      <Section>
        <Group>
          <Row
            accessibilityLabel="Add a computer"
            onPress={() => router.push("/hosts/discover")}
            leading={<Plus size={icon.md} color={colors.accent} strokeWidth={icon.strokeWidth} />}
            title="Add a computer"
          />
          {hosts.length === 0 ? (
            <Row
              accessibilityLabel="Try the demo"
              accessibilityHint="Adds a demo computer with sample agents. It runs inside the app."
              onPress={() => {
                void startDemo().then(() => router.navigate("/"));
              }}
              leading={<Play size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
              title="Try the demo"
              detail="Sample agents that run inside the app. No computer needed."
            />
          ) : null}
        </Group>
      </Section>
    </Screen>
  );
}
