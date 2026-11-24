import { X } from "lucide-react-native";

import { IconButton } from "@/ui/IconButton";

/** The visible close button every sheet has, next to swipe-down. An `IconButton` in its header size. */
export function CloseButton({ onPress, label = "Close" }: { onPress: () => void; label?: string }) {
  return <IconButton label={label} Icon={X} size="header" onPress={onPress} hitSlop={4} />;
}
