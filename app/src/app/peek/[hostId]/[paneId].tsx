import { router as appRouter, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { PeekSheet } from "@/board/PeekSheet";
import { openRunSheet, type RunRequest } from "@/thread/runCommand";
import { confirmDiscard, useDraftGuard } from "@/ui/draftGuard";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

/** The Board's peek sheet (a native form sheet). `reply=1` focuses the composer. A draft asks before the sheet closes. */
export default function PeekScreen() {
  const { hostId, paneId, reply } = useLocalSearchParams<{ hostId: string; paneId: string; reply?: string }>();
  const router = useRouter();
  const [draft, setDraft] = useState(false);
  const allowLeave = useDraftGuard(draft);
  const open = useCallback(() => {
    router.dismiss();
    router.push(`/session/${hostId}/${paneId}` as never);
  }, [router, hostId, paneId]);
  const close = useCallback(() => router.back(), [router]);

  // Run on a code block: the sheet closes first, and the run sheet opens when the sheet is gone.
  // A screen pushed while the form sheet is up shows inside it, and so does the terminal that the
  // run sheet opens after the run. A draft asks first, the same as every other way out.
  const pendingRun = useRef<RunRequest | null>(null);
  // "Why this status?" opens the same way: after the sheet is gone, so it is not inside the sheet.
  const pendingExplain = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (pendingRun.current) openRunSheet(pendingRun.current);
      const explain = pendingExplain.current;
      if (explain) setTimeout(() => appRouter.push(explain as never), 0);
    },
    [],
  );
  const run = useCallback(
    async (req: RunRequest) => {
      if (draft && !(await confirmDiscard())) return;
      pendingRun.current = req;
      allowLeave();
      router.dismiss();
    },
    [draft, allowLeave, router],
  );
  const onRun = useCallback((req: RunRequest) => void run(req), [run]);
  const explain = useCallback(async () => {
    if (draft && !(await confirmDiscard())) return;
    pendingExplain.current = `/explain/${hostId}/${paneId}`;
    allowLeave();
    router.dismiss();
  }, [draft, allowLeave, router, hostId, paneId]);
  const onExplain = useCallback(() => void explain(), [explain]);

  return (
    <PeekSheet
      hostId={hostId}
      paneId={paneId}
      focusComposer={reply === "1"}
      onOpenSession={open}
      onClose={close}
      onDraftChange={setDraft}
      onRun={onRun}
      onExplain={onExplain}
    />
  );
}
