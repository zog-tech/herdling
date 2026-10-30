import { Alert } from "react-native";

/** Manual entry: shows the host key from the answer and asks the user to compare it with the host. */
export function confirmHostKey(fingerprint: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    const message = fingerprint
      ? `${fingerprint}\n\nCheck that zogsshd pair on the host shows the same host key. If it does not, someone on the network may be intercepting the pairing.`
      : "The host reported no host key. Zogssh will trust the key it sees on the first connection. Pair only on a network you trust.";
    Alert.alert(
      fingerprint ? "Check the host key" : "No host key",
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: fingerprint ? "It matches" : "Pair anyway", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
