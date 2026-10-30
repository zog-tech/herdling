import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

import { PeekSheet } from "@/board/PeekSheet";

/** The Board's peek sheet (a native form sheet). `reply=1` focuses the composer. */
export default function PeekScreen() {
  const { hostId, paneId, reply } = useLocalSearchParams<{ hostId: string; paneId: string; reply?: string }>();
  const router = useRouter();
  const open = useCallback(() => {
    router.dismiss();
    router.push(`/session/${hostId}/${paneId}` as never);
  }, [router, hostId, paneId]);
  return <PeekSheet hostId={hostId} paneId={paneId} focusComposer={reply === "1"} onOpenSession={open} />;
}
