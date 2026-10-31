type Listener = (e: any) => void;

// In-memory stand-in for the native ssh module's browse calls.
const mockSsh = {
  listeners: new Map<string, Set<Listener>>(),
  emit(event: string, payload: unknown) {
    this.listeners.get(event)?.forEach((l) => l(payload));
  },
  startBrowse: jest.fn(async (): Promise<void> => {}),
  stopBrowse: jest.fn(async (): Promise<void> => {}),
  addListener(event: string, l: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(l);
    return { remove: () => this.listeners.get(event)!.delete(l) };
  },
};

jest.mock("../../modules/ssh", () => ({
  startBrowse: () => mockSsh.startBrowse(),
  stopBrowse: () => mockSsh.stopBrowse(),
  addListener: (e: string, l: Listener) => mockSsh.addListener(e, l),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));

import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { FoundService } from "../../modules/ssh";
import { applyFound, applyLost, type Discovered, type DiscoveryState, knownHostFor, useDiscovery } from "./discovery";
import type { Host } from "./store";

const STUDIO: FoundService = {
  name: "studio",
  address: "10.0.0.5",
  pairPort: 7790,
  txt: { user: "sam", ssh_port: "2222", fp: "SHA256:abc", ver: "0.2.0" },
};

function host(id: string, address: string, fingerprint?: string): Host {
  return { id, name: id, address, port: 22, user: "sam", fingerprint, command: "herdlingd rpc" };
}

test("found_parses_txt", () => {
  expect(applyFound([], STUDIO)).toEqual<Discovered[]>([
    {
      name: "studio",
      address: "10.0.0.5",
      pairPort: 7790,
      user: "sam",
      sshPort: 2222,
      fingerprint: "SHA256:abc",
      version: "0.2.0",
    },
  ]);
});

test("bad_ssh_port_defaults_to_22", () => {
  for (const ssh_port of ["", "abc", "0", "70000", "22x", "-1"]) {
    const [d] = applyFound([], { ...STUDIO, txt: { ssh_port } });
    expect(d.sshPort).toBe(22);
    expect(d.user).toBeUndefined();
    expect(d.fingerprint).toBeUndefined();
  }
  expect(applyFound([], { ...STUDIO, txt: {} })[0].sshPort).toBe(22);
});

test("found_twice_replaces", () => {
  let list = applyFound([], STUDIO);
  list = applyFound(list, { ...STUDIO, name: "box" });
  list = applyFound(list, { ...STUDIO, address: "10.0.0.6" });
  expect(list.map((d) => [d.name, d.address])).toEqual([
    ["box", "10.0.0.5"],
    ["studio", "10.0.0.6"],
  ]);
});

test("lost_removes", () => {
  const list = applyFound(applyFound([], STUDIO), { ...STUDIO, name: "box" });
  expect(applyLost(list, "studio").map((d) => d.name)).toEqual(["box"]);
  expect(applyLost(list, "other")).toEqual(list);
});

test("known_host_by_fingerprint_then_address", () => {
  const [d] = applyFound([], STUDIO);
  const byAddress = host("a", "10.0.0.5");
  const byFp = host("b", "10.0.0.9", "SHA256:abc");
  expect(knownHostFor(d, [byAddress, byFp])?.id).toBe("b");
  expect(knownHostFor(d, [byAddress])?.id).toBe("a");
  // A host pinned to another key at the same address is a different machine.
  expect(knownHostFor(d, [host("c", "10.0.0.5", "SHA256:other")])).toBeUndefined();
  expect(knownHostFor({ ...d, address: null, fingerprint: undefined }, [byAddress])).toBeUndefined();
  expect(knownHostFor({ ...d, fingerprint: undefined }, [byAddress])?.id).toBe("a");
});

const latest: Record<string, DiscoveryState> = {};
function Probe({ id, active }: { id: string; active: boolean }) {
  latest[id] = useDiscovery(active);
  return null;
}

const names = (id: string) => latest[id].list.map((d) => d.name);

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(el);
  });
  return tree;
}

beforeEach(() => {
  mockSsh.listeners.clear();
  mockSsh.startBrowse.mockReset().mockResolvedValue(undefined);
  mockSsh.stopBrowse.mockReset().mockResolvedValue(undefined);
});

test("use_discovery_browses_only_while_active", async () => {
  const tree = await mount(<Probe id="a" active={false} />);
  expect(mockSsh.startBrowse).not.toHaveBeenCalled();
  expect(latest.a.status).toBe("stopped");

  await act(async () => tree.update(<Probe id="a" active />));
  expect(mockSsh.startBrowse).toHaveBeenCalledTimes(1);
  expect(latest.a.status).toBe("starting");
  await act(async () => {
    mockSsh.emit("onBrowseState", { state: "ready" });
    mockSsh.emit("onServiceFound", STUDIO);
    mockSsh.emit("onServiceFound", { ...STUDIO, name: "box" });
    mockSsh.emit("onServiceLost", { name: "studio" });
  });
  expect(latest.a.status).toBe("ready");
  expect(names("a")).toEqual(["box"]);

  await act(async () => tree.update(<Probe id="a" active={false} />));
  expect(mockSsh.stopBrowse).toHaveBeenCalledTimes(1);
  expect(latest.a).toEqual({ list: [], status: "stopped" });
  expect(mockSsh.listeners.get("onServiceFound")?.size).toBe(0);
  await act(async () => tree.unmount());
});

test("two_consumers_share_one_browse", async () => {
  const tree = await mount(
    <>
      <Probe id="a" active />
      <Probe id="b" active />
    </>,
  );
  expect(mockSsh.startBrowse).toHaveBeenCalledTimes(1);
  await act(async () => mockSsh.emit("onServiceFound", STUDIO));
  expect(names("a")).toEqual(["studio"]);
  expect(names("b")).toEqual(["studio"]);

  // "a" stops: the browse goes on for "b".
  await act(async () =>
    tree.update(
      <>
        <Probe id="a" active={false} />
        <Probe id="b" active />
      </>,
    ),
  );
  expect(mockSsh.stopBrowse).not.toHaveBeenCalled();
  expect(names("a")).toEqual([]);
  await act(async () => mockSsh.emit("onServiceFound", { ...STUDIO, name: "box" }));
  expect(names("b")).toEqual(["box", "studio"]);

  // The last consumer stops: the browse stops once.
  await act(async () => tree.unmount());
  expect(mockSsh.stopBrowse).toHaveBeenCalledTimes(1);
  expect(mockSsh.startBrowse).toHaveBeenCalledTimes(1);
});

test("browse_failure_sets_failed_status", async () => {
  mockSsh.startBrowse.mockRejectedValueOnce(new Error("no browser"));
  let tree = await mount(<Probe id="a" active />);
  expect(latest.a).toEqual({ list: [], status: "failed", error: "no browser" });
  await act(async () => tree.unmount());

  // A native "failed" event clears the list; "waiting" keeps it and shows the reason.
  tree = await mount(<Probe id="a" active />);
  await act(async () => mockSsh.emit("onServiceFound", STUDIO));
  await act(async () => mockSsh.emit("onBrowseState", { state: "waiting", error: "-65570: PolicyDenied" }));
  expect(latest.a.status).toBe("waiting");
  expect(latest.a.error).toBe("-65570: PolicyDenied");
  expect(names("a")).toEqual(["studio"]);
  await act(async () => mockSsh.emit("onBrowseState", { state: "failed", error: "-65555: NoAuth" }));
  expect(latest.a).toEqual({ list: [], status: "failed", error: "-65555: NoAuth" });
  await act(async () => tree.unmount());
});
