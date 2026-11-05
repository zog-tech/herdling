/** The icon of a permission mode, for the start bar pill and the rows of the options sheet. */
import { ClipboardList, FilePen, Shield, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react-native";

import { DEFAULT_MODE_ID, type PermissionMode } from "./startOptions";

/** The same icons show for the same kind of mode in every agent. */
export function modeIcon(mode: PermissionMode): LucideIcon {
  if (mode.danger) return ShieldAlert;
  if (mode.id === DEFAULT_MODE_ID) return Shield;
  if (mode.id === "plan") return ClipboardList;
  if (mode.id === "acceptEdits" || mode.id === "autoEdit") return FilePen;
  return ShieldCheck;
}
