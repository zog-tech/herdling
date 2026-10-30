import { useRouter } from "expo-router";
import { KeyRound } from "lucide-react-native";
import { useState } from "react";
import { Alert, View } from "react-native";

import { SetupFailed, setUpWithPassword } from "@/hosts/passwordSetup";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Shows the probed host key. The password is sent only after "It matches". */
function confirmProbedKey(fingerprint: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      "Check the host key",
      `${fingerprint}\n\nCheck this matches the host:\nssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub\n\nIf it does not, someone on the network may be intercepting the connection.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "It matches", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function portOf(text: string): number | undefined {
  const n = Number(text);
  return /^\d+$/.test(text) && n >= 1 && n <= 65535 ? n : undefined;
}

/** "Set up with password": one password login adds this phone's key; the password is not kept. */
export default function PasswordSetupScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [portText, setPortText] = useState("22");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const port = portOf(portText);
  const valid = address.trim() !== "" && user.trim() !== "" && password !== "" && port !== undefined;

  const connect = async () => {
    if (!valid || busy || port === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await setUpWithPassword({ name, address, port, user, password, confirm: confirmProbedKey });
      router.dismissTo("/");
    } catch (e) {
      setError(e instanceof SetupFailed ? e.message : "Setup failed. Nothing was saved.");
    } finally {
      // The password is used for one attempt only.
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Text variant="small" muted>
          For a host that allows SSH password login and has zogsshd installed. Zogssh logs in once, adds its own
          key, and does not keep the password.
        </Text>
        <Field label="Name (optional)" value={name} onChangeText={setName} placeholder="Studio" editable={!busy} />
        <Field
          label="Host"
          value={address}
          onChangeText={setAddress}
          placeholder="10.0.0.5"
          keyboardType="url"
          editable={!busy}
        />
        <Field
          label="Port"
          value={portText}
          onChangeText={(t) => setPortText(t.replace(/\D/g, "").slice(0, 5))}
          keyboardType="number-pad"
          mono
          editable={!busy}
        />
        <Field label="User" value={user} onChangeText={setUser} placeholder="sam" editable={!busy} />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          autoComplete="off"
          importantForAutofill="no"
          editable={!busy}
          onSubmitEditing={() => void connect()}
        />
        {portText !== "" && port === undefined ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            Port must be 1 to 65535.
          </Text>
        ) : null}
        {error ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </Card>
      <View style={{ gap: space.md }}>
        <Button label="Connect" Icon={KeyRound} loading={busy} disabled={!valid} onPress={() => void connect()} />
      </View>
    </Screen>
  );
}
