import { editPatch } from "./editPatch";
import type { Host } from "./store";

const old: Host = {
  id: "h1",
  name: "Box",
  address: "box.example.com",
  port: 22,
  user: "sam",
  command: "zogsshd rpc",
  fingerprint: "SHA256:abc",
};
const values = { name: old.name, address: old.address, port: old.port, user: old.user, command: old.command };

describe("editPatch", () => {
  it("keeps_the_pin_when_address_and_port_stay", () => {
    const p = editPatch(old, { ...values, name: "Renamed", user: "alex" });
    expect("fingerprint" in p).toBe(false);
  });

  it("clears_the_pin_when_the_address_changes", () => {
    const p = editPatch(old, { ...values, address: "other.example.com" });
    expect("fingerprint" in p).toBe(true);
    expect(p.fingerprint).toBeUndefined();
  });

  it("clears_the_pin_when_the_port_changes", () => {
    const p = editPatch(old, { ...values, port: 2222 });
    expect("fingerprint" in p).toBe(true);
    expect(p.fingerprint).toBeUndefined();
  });
});
