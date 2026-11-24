import { useEffect, useState } from "react";

import { ensureKey } from "../../modules/ssh";
import { KeyRow } from "@/hosts/flowParts";

import { publicKeyFingerprint } from "./keyFingerprint";

/** The fingerprint of this phone's SSH key, or undefined while it loads or when it fails. */
export function usePhoneKeyFingerprint(): string | undefined {
  const [fp, setFp] = useState<string>();
  useEffect(() => {
    let live = true;
    ensureKey().then(
      (k) => {
        if (live) setFp(publicKeyFingerprint(k.publicKey) ?? undefined);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  return fp;
}

/**
 * This phone's key fingerprint as a row of a `Group`, so the user can compare it with the phone key
 * that `herdlingd pair` shows on the computer. Nothing shows until the key is known: the caller
 * leaves the row out of its `Group` until then, so the band has no empty row.
 */
export function PhoneKey({ fingerprint }: { fingerprint?: string }) {
  if (!fingerprint) return null;
  return <KeyRow title="This phone's key" fingerprint={fingerprint} />;
}
