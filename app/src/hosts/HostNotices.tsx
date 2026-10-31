import { useRouter } from "expo-router";
import { Power, TriangleAlert } from "lucide-react-native";

import { colors } from "@/theme/tokens";
import { Card } from "@/ui/Card";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

import { LOGIN_HINT, startsAtLogin } from "./boot";
import { useHostConn } from "./connection";
import { useHosts } from "./store";

/** The text when herdlingd runs but cannot reach herdr. */
export function herdrNotRunningText(name: string): string {
  return `herdr is not running on ${name}. Start herdr in a terminal on that computer.`;
}

/**
 * The state of an online host that needs the user: herdr is not running, or herdlingd starts only
 * after a login. Nothing when the host is offline or all is well.
 */
export function HostNotices({ hostId }: { hostId: string }) {
  const router = useRouter();
  const host = useHosts((s) => s.hosts.find((h) => h.id === hostId));
  const conn = useHostConn(hostId);
  const hello = conn.status === "online" ? conn.hello : undefined;
  if (!host || !hello) return null;
  const herdrDown = !hello.herdr_ok;
  const login = startsAtLogin(hello);
  if (!herdrDown && !login) return null;
  return (
    <Card>
      {herdrDown ? (
        <>
          <StateNotice Icon={TriangleAlert} color={colors.status.blocked} message={herdrNotRunningText(host.name)} />
          <Text variant="small" muted>
            In a terminal, run herdr. Then you can close the terminal window: herdr keeps running in the background.
          </Text>
        </>
      ) : null}
      {login ? (
        <StateNotice
          Icon={Power}
          message={LOGIN_HINT}
          action="How to start at boot"
          onAction={() => router.push({ pathname: "/hosts/boot-help", params: { id: host.id } })}
        />
      ) : null}
    </Card>
  );
}
