import { linuxSshSteps, macRemoteLoginSteps, reachFailure, reachLead } from "./sshHelp";

describe("reachFailure", () => {
  it("reads the native texts of iOS and Android", () => {
    expect(reachFailure("connect_failed", "Connection refused")).toBe("refused");
    expect(reachFailure("connect_failed", "connect(): ECONNREFUSED (Connection refused)")).toBe("refused");
    expect(reachFailure("connect_failed", "failed to connect to /10.0.0.5 (port 22): EHOSTUNREACH (No route to host)")).toBe("no_route");
    expect(reachFailure("connect_failed", "Unable to resolve host \"studio.local\": No address associated with hostname")).toBe(
      "no_route",
    );
    expect(reachFailure("connect_failed", "connect timed out")).toBe("no_answer");
    expect(reachFailure("connect_failed", "something else")).toBe("other");
    expect(reachFailure("timeout", "")).toBe("no_answer");
  });

  it("is null for errors that are not about the port", () => {
    expect(reachFailure("auth_failed", "Connection refused")).toBeNull();
    expect(reachFailure("host_key_mismatch", "")).toBeNull();
    expect(reachFailure(undefined, "Connection refused")).toBeNull();
  });
});

describe("walkthrough steps", () => {
  it("names the Mac menus and the user", () => {
    const text = macRemoteLoginSteps("sam").map((s) => s.text).join("\n");
    for (const part of ["System Settings", "General", "Sharing", "Remote Login", "Only these users", '"sam"', "full disk access"]) {
      expect(text).toContain(part);
    }
    expect(macRemoteLoginSteps().map((s) => s.text).join("\n")).toContain("your user");
  });

  it("gives copyable Linux commands", () => {
    const commands = linuxSshSteps().flatMap((s) => (s.command ? [s.command] : []));
    expect(commands).toContain("sudo apt install openssh-server");
    expect(commands).toContain("sudo systemctl enable --now ssh");
  });

  it("leads with the kind of failure", () => {
    expect(reachLead("refused", "10.0.0.5")).toContain("SSH is off");
    expect(reachLead("no_route", "10.0.0.5")).toContain("same network or VPN");
    expect(reachLead(undefined, "10.0.0.5")).toContain("10.0.0.5");
  });
});
