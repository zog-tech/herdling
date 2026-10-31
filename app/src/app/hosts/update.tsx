import { useLocalSearchParams, useRouter } from "expo-router";
import { ExternalLink, KeyRound } from "lucide-react-native";
import { useState } from "react";
import { Linking, View } from "react-native";

import { HERDR_URL } from "@/hosts/installer";
import { useHosts } from "@/hosts/store";
import { updateWithPassword } from "@/hosts/updates";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { DelayedSpinner } from "@/ui/Delayed";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/**
 * Updates a herdlingd that is too old to update itself: one password login runs the installer,
 * pinned to the saved host key. The password is used for this one login and is not kept.
 */
export default function UpdateWithPasswordScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const host = useHosts((s) => s.hosts.find((h) => h.id === id));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();

  if (!host)
    return (
      <Screen>
        <Text muted>Host not found.</Text>
      </Screen>
    );

  const run = async () => {
    if (busy || password === "") return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await updateWithPassword(host, password);
      if (r.ok) setDone(`herdlingd ${r.version} is installed. ${host.name} reconnects now.`);
      else setError(r.message);
    } catch {
      setError("The update failed.");
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
          Herdling logs in to {host.user}@{host.address} once with your SSH password and runs the herdlingd installer. It
          downloads the latest herdlingd from GitHub, checks it, installs it to ~/.local/bin and restarts the user
          service. No admin rights. The password is not kept.
        </Text>
        {host.fingerprint ? null : (
          <Text color={colors.danger}>The host key is not pinned yet. Connect the host once first.</Text>
        )}
        {done ? null : (
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            autoComplete="off"
            importantForAutofill="no"
            editable={!busy}
            onSubmitEditing={() => void run()}
          />
        )}
        {busy ? (
          <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <DelayedSpinner color={colors.textMuted} />
            <Text muted style={{ flex: 1 }}>
              Installing herdlingd. This can take a minute…
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {error?.includes(HERDR_URL) ? (
          <Button label="Open herdr.dev" variant="secondary" Icon={ExternalLink} onPress={() => void Linking.openURL(HERDR_URL)} />
        ) : null}
        {done ? (
          <Text color={colors.status.done} accessibilityLiveRegion="polite">
            {done}
          </Text>
        ) : null}
      </Card>
      <View style={{ gap: space.md }}>
        {done ? (
          <Button label="Done" onPress={() => router.back()} />
        ) : (
          <Button
            label="Update herdlingd"
            Icon={KeyRound}
            loading={busy}
            disabled={password === "" || !host.fingerprint}
            onPress={() => void run()}
          />
        )}
      </View>
    </Screen>
  );
}
