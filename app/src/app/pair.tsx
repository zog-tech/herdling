import { Redirect, useLocalSearchParams } from "expo-router";

import { parsePairUrl } from "@/pairing/pairUrl";

/** Deep link `zogssh://pair?h=<host>&p=<port>&c=<code>&f=<fingerprint>`: opens the pair screen with the values filled in. */
export default function PairLink() {
  const { h, p, c, f } = useLocalSearchParams<{ h?: string; p?: string; c?: string; f?: string }>();
  const query = [["h", h], ["p", p], ["c", c], ["f", f]]
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  const target = parsePairUrl(`zogssh://pair?${query}`);
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
        },
      }}
    />
  );
}
