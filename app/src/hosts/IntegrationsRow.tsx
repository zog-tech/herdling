import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { groupIntegrations, LIST_METHOD, listIntegrations } from "@/herdr/integrations";
import { useHerdrSupports } from "@/herdr/support";
import { Card } from "@/ui/Card";
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
 * not know the method. `card`: in a `Card`, for a screen of cards.
 */
export function IntegrationsRow({ hostId, card }: { hostId: string; card?: boolean }) {
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
  const row = (
    <Row
      title="Agent integrations"
      detail={integrationsDetail(missing)}
      chevron
      accessibilityHint="Shows the herdr integrations of this computer"
      onPress={() => router.push({ pathname: "/hosts/integrations", params: { id: hostId } })}
    />
  );
  return card ? <Card>{row}</Card> : row;
}
