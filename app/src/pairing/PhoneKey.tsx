import { useEffect, useState } from "react";
import { View } from "react-native";

import { ensureKey } from "../../modules/ssh";
import { space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

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
 * This phone's key fingerprint, so the user can compare it with the phone key that
 * `herdlingd pair` shows on the computer. Nothing shows until the key is known.
 */
export function PhoneKey({ fingerprint }: { fingerprint?: string }) {
  if (!fingerprint) return null;
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="small" muted>
        This phone's key
      </Text>
      <Text variant="caption" mono selectable accessibilityLabel={`This phone's key ${fingerprint}`}>
        {fingerprint}
      </Text>
    </View>
  );
}
