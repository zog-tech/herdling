import { useLocalSearchParams, useRouter } from "expo-router";
import { Link2, QrCode } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { confirmHostKey } from "@/pairing/confirmHostKey";
import { type HostKeyCheck, PairFailed, pairWithHost } from "@/pairing/pair";
import { DEFAULT_PAIR_PORT, FINGERPRINT_RE } from "@/pairing/pairUrl";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

type Params = { address?: string; port?: string; code?: string; name?: string; fingerprint?: string };


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
  const port = portOf(params.port);
  // The QR key belongs to the scanned address only: an edited address falls back to manual confirmation.
  const qrFingerprint =
    params.fingerprint && FINGERPRINT_RE.test(params.fingerprint) && address.trim() === params.address
      ? params.fingerprint
      : undefined;

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
      await pairWithHost({ address: address.trim(), port, code, name: params.name, check });
      router.dismissTo("/");
    } catch (e) {
      setError(e instanceof PairFailed ? e.message : e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

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
