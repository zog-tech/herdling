type Listener = (e: any) => void;

// In-memory stand-in for the native ssh module's browse calls.
const mockSsh = {
  listeners: new Map<string, Set<Listener>>(),
  emit(event: string, payload: unknown) {
    this.listeners.get(event)?.forEach((l) => l(payload));
  },
  startBrowse: jest.fn(async () => {}),
  stopBrowse: jest.fn(async () => {}),
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
import { applyFound, applyLost, type Discovered, knownHostFor, useDiscovery } from "./discovery";
import type { Host } from "./store";

const MINI: FoundService = {
  name: "mini",
  address: "10.0.0.5",
  pairPort: 7790,
  txt: { user: "sam", ssh_port: "2222", fp: "SHA256:abc", ver: "0.2.0" },
};

function host(id: string, address: string, fingerprint?: string): Host {
  return { id, name: id, address, port: 22, user: "sam", fingerprint, command: "zogsshd rpc" };
}

test("found_parses_txt", () => {
  expect(applyFound([], MINI)).toEqual<Discovered[]>([
    {
      name: "mini",
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
    const [d] = applyFound([], { ...MINI, txt: { ssh_port } });
    expect(d.sshPort).toBe(22);
    expect(d.user).toBeUndefined();
    expect(d.fingerprint).toBeUndefined();
  }
  expect(applyFound([], { ...MINI, txt: {} })[0].sshPort).toBe(22);
});

test("found_twice_replaces", () => {
  let list = applyFound([], MINI);
  list = applyFound(list, { ...MINI, name: "box" });
  list = applyFound(list, { ...MINI, address: "10.0.0.6" });
  expect(list.map((d) => [d.name, d.address])).toEqual([
    ["box", "10.0.0.5"],
    ["mini", "10.0.0.6"],
  ]);
});

test("lost_removes", () => {
  const list = applyFound(applyFound([], MINI), { ...MINI, name: "box" });
  expect(applyLost(list, "mini").map((d) => d.name)).toEqual(["box"]);
  expect(applyLost(list, "other")).toEqual(list);
});

test("known_host_by_fingerprint_then_address", () => {
  const [d] = applyFound([], MINI);
  const byAddress = host("a", "10.0.0.5");
  const byFp = host("b", "10.0.0.9", "SHA256:abc");
  expect(knownHostFor(d, [byAddress, byFp])?.id).toBe("b");
  expect(knownHostFor(d, [byAddress])?.id).toBe("a");
  // A host pinned to another key at the same address is a different machine.
  expect(knownHostFor(d, [host("c", "10.0.0.5", "SHA256:other")])).toBeUndefined();
  expect(knownHostFor({ ...d, address: null, fingerprint: undefined }, [byAddress])).toBeUndefined();
  expect(knownHostFor({ ...d, fingerprint: undefined }, [byAddress])?.id).toBe("a");
});

let latest: Discovered[] = [];
function Probe({ active }: { active: boolean }) {
  latest = useDiscovery(active);
  return null;
}

test("use_discovery_browses_only_while_active", async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe active={false} />);
  });
  expect(mockSsh.startBrowse).not.toHaveBeenCalled();

  await act(async () => tree.update(<Probe active />));
  expect(mockSsh.startBrowse).toHaveBeenCalledTimes(1);
  await act(async () => {
    mockSsh.emit("onServiceFound", MINI);
    mockSsh.emit("onServiceFound", { ...MINI, name: "box" });
    mockSsh.emit("onServiceLost", { name: "mini" });
  });
  expect(latest.map((d) => d.name)).toEqual(["box"]);

  await act(async () => tree.update(<Probe active={false} />));
  expect(mockSsh.stopBrowse).toHaveBeenCalledTimes(1);
  expect(latest).toEqual([]);
  expect(mockSsh.listeners.get("onServiceFound")?.size).toBe(0);
  await act(async () => tree.unmount());
});
