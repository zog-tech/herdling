import { useHosts } from "./store";
import { useUpdateCheck } from "./updates";

function HostUpdateCheck({ hostId }: { hostId: string }) {
  useUpdateCheck(hostId);
  return null;
}

/** Checks each saved host for a herdlingd update (at most once a day). Renders nothing. Put it once in the root layout. */
export function UpdateChecks() {
  const ids = useHosts((s) => s.hosts.map((h) => h.id).join(","));
  return (
    <>
      {ids
        .split(",")
        .filter(Boolean)
        .map((id) => (
          <HostUpdateCheck key={id} hostId={id} />
        ))}
    </>
  );
}
