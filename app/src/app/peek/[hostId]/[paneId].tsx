import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";

import { PeekSheet } from "@/board/PeekSheet";
import { useDraftGuard } from "@/ui/draftGuard";

/** The Board's peek sheet (a native form sheet). `reply=1` focuses the composer. A draft asks before the sheet closes. */
export default function PeekScreen() {
  const { hostId, paneId, reply } = useLocalSearchParams<{ hostId: string; paneId: string; reply?: string }>();
  const router = useRouter();
  const [draft, setDraft] = useState(false);
  useDraftGuard(draft);
  const open = useCallback(() => {
    router.dismiss();
    router.push(`/session/${hostId}/${paneId}` as never);
  }, [router, hostId, paneId]);
  const close = useCallback(() => router.back(), [router]);
  return (
    <PeekSheet
      hostId={hostId}
      paneId={paneId}
      focusComposer={reply === "1"}
      onOpenSession={open}
      onClose={close}
      onDraftChange={setDraft}
    />
  );
}
