import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, Link2, QrCode } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { confirmHostKey } from "@/pairing/confirmHostKey";
import { confirmLegacyPairing } from "@/pairing/confirmLegacy";
import { type HostKeyCheck, PairFailed, pairWithHost } from "@/pairing/pair";
import { DEFAULT_PAIR_PORT, FINGERPRINT_RE } from "@/pairing/pairUrl";
import { PhoneKey, usePhoneKeyFingerprint } from "@/pairing/PhoneKey";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** `v`: "2" when the QR code or the Bonjour advert says that the host has pairing v2. */
type Params = { address?: string; port?: string; code?: string; name?: string; fingerprint?: string; v?: string };


function portOf(text: string | undefined): number {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_PAIR_PORT;
}

/** Pair by code: address (prefilled from discovery, a QR or a deep link) and the 6-digit code. */
export default function PairScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const [address, setAddress] = useState(params.address ?? "");
  const [code, setCode] = useState(params.code ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** The name of the paired host. The screen then shows the phone key to check on the host. */
  const [paired, setPaired] = useState<string>();
  const phoneKey = usePhoneKeyFingerprint();
  const port = portOf(params.port);
  // The QR key belongs to the scanned address only: an edited address falls back to manual confirmation.
  const qrFingerprint =
    params.fingerprint && FINGERPRINT_RE.test(params.fingerprint) && address.trim() === params.address
      ? params.fingerprint
      : undefined;
  // Pairing v2 only: never fall back to v1, even when the address was edited.
  const requireV2 = params.v === "2";

  // A scan returns here with new params.
  useEffect(() => {
    if (params.address) setAddress(params.address);
    if (params.code) setCode(params.code);
    setError(undefined);
  }, [params.address, params.code]);

  const valid = address.trim() !== "" && /^\d{6}$/.test(code);

  const pair = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const check: HostKeyCheck = qrFingerprint ? { fingerprint: qrFingerprint } : { confirm: confirmHostKey };
      const { host, checked } = await pairWithHost({
        address: address.trim(),
        port,
        code,
        name: params.name,
        check,
        requireV2,
        confirmLegacy: confirmLegacyPairing,
      });
      // Pairing v2 proved the code both ways, so the host got this phone's key. With v1, a key
      // that did not load leaves nothing to compare.
      if (checked || !phoneKey) {
        router.dismissTo("/");
        return;
      }
      setPaired(host.name);
      setBusy(false);
    } catch (e) {
      setError(e instanceof PairFailed ? e.message : e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // After pairing v1 (an older herdlingd): a relay on the network can send the code with its own
  // key. The host shows the key that it got, so the user compares it with this phone's key.
  if (paired) {
    return (
      <Screen>
        <Card>
          <Text variant="title">Paired with {paired}</Text>
          <PhoneKey fingerprint={phoneKey} />
          <Text variant="small" muted>
            Check that herdlingd pair on the host shows the same phone key. If the key is different, do not keep it on the host.
          </Text>
        </Card>
        <Button label="Done" Icon={Check} onPress={() => router.dismissTo("/")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Text variant="small" muted>
          On the host, run herdlingd pair. Enter the code it shows, or scan its QR code. Use the host's IP address or its .local name.
        </Text>
        <Field
          label="Address"
          value={address}
          onChangeText={setAddress}
          placeholder="10.0.0.5"
          keyboardType="url"
          editable={!busy}
        />
        {port !== DEFAULT_PAIR_PORT ? (
          <Text variant="caption" muted>
            Pairing port {port}
          </Text>
        ) : null}
        <Field
          label="Code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          mono
          editable={!busy}
          onSubmitEditing={() => valid && !busy && void pair()}
        />
        {qrFingerprint ? (
          <Text variant="caption" muted mono selectable accessibilityLabel={`Host key from the QR code ${qrFingerprint}`}>
            Host key {qrFingerprint}
          </Text>
        ) : null}
        <PhoneKey fingerprint={phoneKey} />
        {error ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </Card>
      <View style={{ gap: space.md }}>
        <Button label="Pair" Icon={Link2} loading={busy} disabled={!valid} onPress={() => void pair()} />
        <Button
          label="Scan QR"
          variant="secondary"
          Icon={QrCode}
          disabled={busy}
          onPress={() => router.push("/hosts/scan")}
        />
      </View>
    </Screen>
  );
}
