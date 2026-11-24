import { useRouter } from "expo-router";
import { Puzzle } from "lucide-react-native";
import { useEffect, useState } from "react";

import { groupIntegrations, LIST_METHOD, listIntegrations } from "@/herdr/integrations";
import { useHerdrSupports } from "@/herdr/support";
import { colors, icon } from "@/theme/tokens";
import { Row } from "@/ui/Row";

import { useHostConn } from "./connection";

/** The detail line of the row: how many integrations need an install. */
export function integrationsDetail(missing: number | undefined): string {
  if (missing === undefined) return "Agent status hooks for herdr";
  if (missing === 0) return "Each agent on the computer has one";
  return missing === 1 ? "1 agent has no current integration" : `${missing} agents have no current integration`;
}

/**
 * The "Agent integrations" row of the host screen. It reads `integration.list` once while the
 * host is online, for the count in the detail line. It hides when the herdr of the host does
 * not know the method. Put it in a `Group`; `useIntegrationsShown` tells the parent if it shows.
 */
export function IntegrationsRow({ hostId }: { hostId: string }) {
  const router = useRouter();
  const { rpc, hello } = useHostConn(hostId);
  const supported = useHerdrSupports(hostId, LIST_METHOD);
  const [missing, setMissing] = useState<number>();

  useEffect(() => {
    if (!rpc || !supported || hello?.herdr_ok === false) return;
    let live = true;
    listIntegrations(rpc, hostId).then(
      (list) => live && setMissing(groupIntegrations(list).missing.length),
      // An unknown method hides the row (`useHerdrSupports`); other errors keep the plain detail.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [rpc, hello, supported, hostId]);

  if (!supported) return null;
  return (
    <Row
      title="Agent integrations"
      leading={<Puzzle size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
      detail={integrationsDetail(missing)}
      chevron
      accessibilityHint="Shows the herdr integrations of this computer"
      onPress={() => router.push({ pathname: "/hosts/integrations", params: { id: hostId } })}
    />
  );
}

/** True when `IntegrationsRow` shows for the host: its herdr knows `integration.list`. */
export function useIntegrationsShown(hostId: string): boolean {
  return useHerdrSupports(hostId, LIST_METHOD);
}
