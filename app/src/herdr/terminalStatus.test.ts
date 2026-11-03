import { fetchTerminalStatuses, setHostStatuses, statusLabel, terminalStatus, trimCommand, useTerminalStatus } from "./terminalStatus";

describe("terminalStatus", () => {
  it("is idle when the shell is in the foreground", () => {
    expect(terminalStatus({ process_info: { shell_pid: 41, foreground_process_group_id: 41, foreground_processes: [{ pid: 41, name: "zsh" }] } })).toEqual({
      kind: "idle",
    });
    expect(statusLabel({ kind: "idle" })).toBe("Idle");
  });

  it("shows the command line of the group leader", () => {
    const s = terminalStatus({
      process_info: {
        shell_pid: 41,
        foreground_process_group_id: 77,
        foreground_processes: [
          { pid: 78, name: "esbuild", cmdline: "esbuild --watch" },
          { pid: 77, name: "node", argv: ["npm", "run", "dev"], cmdline: "npm run dev" },
        ],
      },
    });
    expect(s).toEqual({ kind: "running", command: "npm run dev" });
    expect(statusLabel(s!)).toBe("Running: npm run dev");
  });

  it("falls back to the first process, then argv, then the name", () => {
    const run = (procs: object[]) => terminalStatus({ process_info: { shell_pid: 41, foreground_process_group_id: 77, foreground_processes: procs } });
    expect(run([{ pid: 80, name: "vim", argv: ["vim", "a.txt"] }])).toEqual({ kind: "running", command: "vim a.txt" });
    expect(run([{ pid: 77, name: "top", cmdline: "  " }])).toEqual({ kind: "running", command: "top" });
    expect(run([])).toEqual({ kind: "running", command: "a process" });
    expect(terminalStatus({ process_info: { shell_pid: 41, foreground_process_group_id: 77 } })).toEqual({ kind: "running", command: "a process" });
  });

  it("is unknown when fields are missing", () => {
    expect(terminalStatus(undefined)).toBeUndefined();
    expect(terminalStatus({})).toBeUndefined();
    expect(terminalStatus({ process_info: { shell_pid: null, foreground_process_group_id: 41 } })).toBeUndefined();
    expect(terminalStatus({ process_info: { shell_pid: 41 } })).toBeUndefined();
  });

  it("cuts a long command to 40 characters", () => {
    const long = "node ./node_modules/.bin/vite --host 0.0.0.0 --port 5173";
    const s = terminalStatus({ process_info: { shell_pid: 1, foreground_process_group_id: 2, foreground_processes: [{ pid: 2, cmdline: long }] } });
    expect(s).toEqual({ kind: "running", command: trimCommand(long) });
    expect(trimCommand(long).length).toBeLessThanOrEqual(40);
    expect(trimCommand(long).endsWith("…")).toBe(true);
    expect(trimCommand("short")).toBe("short");
  });
});

describe("fetchTerminalStatuses", () => {
  it("asks one pane after the other, at most 12, and skips panes with no answer", async () => {
    const asked: string[] = [];
    const rpc = {
      call: jest.fn(async (_m: string, p: { params: { pane_id: string } }) => {
        asked.push(p.params.pane_id);
        if (p.params.pane_id === "p2") throw new Error("not_found");
        return { process_info: { shell_pid: 1, foreground_process_group_id: 1 } };
      }),
    };
    const ids = Array.from({ length: 15 }, (_, i) => `p${i}`);
    const r = await fetchTerminalStatuses(rpc as never, ids);
    expect(asked).toEqual(ids.slice(0, 12));
    expect(rpc.call).toHaveBeenCalledWith("herdr.call", { method: "pane.process_info", params: { pane_id: "p0" } });
    expect(Object.keys(r)).toHaveLength(11);
    expect(r.p2).toBeUndefined();
  });
});

test("setHostStatuses replaces the asked panes of one host only", () => {
  useTerminalStatus.setState({ byKey: { "h1:p1": { kind: "idle" }, "h2:p1": { kind: "idle" } } });
  setHostStatuses("h1", ["p1", "p2"], { p2: { kind: "running", command: "make" } });
  expect(useTerminalStatus.getState().byKey).toEqual({ "h2:p1": { kind: "idle" }, "h1:p2": { kind: "running", command: "make" } });
});
