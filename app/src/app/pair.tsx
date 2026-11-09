import { Redirect, useLocalSearchParams } from "expo-router";

import { parsePairUrl } from "@/pairing/pairUrl";

/** Deep link `herdling://pair?h=<host>&p=<port>&c=<code>&f=<fingerprint>&v=2`: opens the pair screen with the values filled in. */
export default function PairLink() {
  const { h, p, c, f, v } = useLocalSearchParams<{ h?: string; p?: string; c?: string; f?: string; v?: string }>();
  const query = [["h", h], ["p", p], ["c", c], ["f", f], ["v", v]]
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  const target = parsePairUrl(`herdling://pair?${query}`);
  if (!target) return <Redirect href="/hosts/discover" />;
  return (
    <Redirect
      href={{
        pathname: "/hosts/pair",
        params: {
          address: target.address,
          port: String(target.port),
          code: target.code,
          ...(target.fingerprint ? { fingerprint: target.fingerprint } : {}),
          ...(target.requireV2 ? { v: "2" } : {}),
        },
      }}
    />
  );
}
