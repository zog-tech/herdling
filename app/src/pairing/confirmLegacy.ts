import { Alert } from "react-native";

/** The text of the dialog before pairing v1 with an older herdlingd. */
export const LEGACY_TITLE = "Older herdlingd";
export const LEGACY_MESSAGE =
  "This computer runs an older herdlingd. Pairing is less safe: the code goes over the network in clear text, so a device on this network can read it. Update herdlingd on the computer, or continue and compare the keys after pairing.";

/**
 * Asks the user before pairing v1 (the host has no pairing v2). True only for "Continue";
 * "Cancel" and a dismissed dialog are false.
 */
export function confirmLegacyPairing(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      LEGACY_TITLE,
      LEGACY_MESSAGE,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue", style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
