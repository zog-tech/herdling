import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

import { SessionDetail } from "@/thread/SessionDetail";

/**
 * The session as a pushed screen: compact width (phones), and the route of pushes and deep links.
 * In regular width `LayoutSync` moves it into the detail column of Overview.
 */
export default function SessionScreen() {
  const { hostId, paneId, prompt, promptError, from } = useLocalSearchParams<{
    hostId: string;
    paneId: string;
    /** Set by New session when the first prompt failed after the agent started. */
    prompt?: string;
    promptError?: string;
    /** "push" when a notification opened the session. */
    from?: string;
  }>();
  const router = useRouter();
  const openPane = useCallback((target: string) => router.replace(`/session/${hostId}/${target}` as never), [router, hostId]);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/")), [router]);
  return (
    <SessionDetail
      hostId={hostId}
      paneId={paneId}
      prompt={prompt}
      promptError={promptError}
      from={from}
      active
      header="native"
      onOpenPane={openPane}
      onClosed={back}
      neighborShortcuts
    />
  );
}
