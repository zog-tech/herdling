import { Redirect, useLocalSearchParams } from "expo-router";

import { parsePairUrl } from "@/pairing/pairUrl";

/** Deep link `zogssh://pair?h=<host>&p=<port>&c=<code>`: opens the pair screen with the values filled in. */
export default function PairLink() {
  const { h, p, c } = useLocalSearchParams<{ h?: string; p?: string; c?: string }>();
  const query = [["h", h], ["p", p], ["c", c]]
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  const target = parsePairUrl(`zogssh://pair?${query}`);
  if (!target) return <Redirect href="/hosts/discover" />;
  return (
    <Redirect
      href={{
        pathname: "/hosts/pair",
        params: { address: target.address, port: String(target.port), code: target.code },
      }}
    />
  );
}
