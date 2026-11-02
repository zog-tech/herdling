import type { Snapshot } from "@/herdr/snapshot";

import { busyProcess, fenceLang, isShellLang, paneFolder, runCommand, runnableCommand } from "./runCommand";

describe("runnableCommand", () => {
  test("only_shell_languages_get_a_command", () => {
    for (const lang of ["bash", "sh", "zsh", "shell", "console", "terminal", "fish", "shellsession", "BASH", "Sh"]) {
      expect(runnableCommand(lang, "ls")).toBe("ls");
    }
    for (const lang of ["ts", "python", "json", "", undefined, "bashrc"]) {
      expect(runnableCommand(lang, "ls")).toBeNull();
    }
  });

  test("the_language_is_the_first_word_of_the_info_string", () => {
    expect(fenceLang(" bash title=run.sh")).toBe("bash");
    expect(isShellLang("zsh {.line-numbers}")).toBe(true);
    expect(runnableCommand("sh title=x", "pnpm test")).toBe("pnpm test");
  });

  test("strips_a_prompt_on_each_line", () => {
    expect(runnableCommand("bash", "$ cd app\n% pnpm test")).toBe("cd app\npnpm test");
    expect(runnableCommand("sh", "  $ ls")).toBe("ls");
    // Not a prompt: no space after the mark.
    expect(runnableCommand("sh", "$HOME/bin/run")).toBe("$HOME/bin/run");
  });

  test("session_blocks_keep_only_the_prompt_lines", () => {
    const out = "$ ls\nREADME.md\nsrc\n$ git status\nOn branch main";
    expect(runnableCommand("console", out)).toBe("ls\ngit status");
    expect(runnableCommand("shellsession", out)).toBe("ls\ngit status");
    expect(runnableCommand("terminal", out)).toBe("ls\ngit status");
    // With no prompt, every line is a command.
    expect(runnableCommand("console", "ls\npwd")).toBe("ls\npwd");
    // A plain shell block keeps its other lines.
    expect(runnableCommand("bash", "$ ls\necho hi")).toBe("ls\necho hi");
  });

  test("trims_trailing_blank_lines_and_returns_null_when_empty", () => {
    expect(runnableCommand("bash", "make\n\n  \n")).toBe("make");
    expect(runnableCommand("bash", "a\r\nb\r\n")).toBe("a\nb");
    expect(runnableCommand("bash", "\n  \n")).toBeNull();
    expect(runnableCommand("bash", "$ ")).toBeNull();
  });
});

test("busy_process_names_the_foreground_process", () => {
  expect(busyProcess(undefined)).toBeUndefined();
  expect(busyProcess({ process_info: { shell_pid: 41, foreground_process_group_id: 41 } })).toBeUndefined();
  expect(busyProcess({ process_info: { shell_pid: null } })).toBeUndefined();
  expect(
    busyProcess({
      process_info: {
        shell_pid: 41,
        foreground_process_group_id: 77,
        foreground_processes: [
          { pid: 78, name: "node" },
          { pid: 77, name: "vim" },
        ],
      },
    }),
  ).toBe("vim");
  expect(busyProcess({ process_info: { shell_pid: 41, foreground_process_group_id: 77 } })).toBe("a process");
});

const SNAP: Snapshot = {
  agents: [{ pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", agent: "claude", agent_status: "idle", cwd: "/home/sam/proj", state_change_seq: 1 }],
  workspaces: [{ workspace_id: "w1", label: "proj", number: 1, agent_status: "idle" }],
  tabs: [],
  panes: [
    { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", agent: "claude", cwd: "/home/sam/proj" },
    { pane_id: "w2:p1", tab_id: "w2:t1", workspace_id: "w2", cwd: "/home/sam/other" },
  ],
};

test("pane_folder_is_the_agent_folder_else_the_pane_folder", () => {
  expect(paneFolder(SNAP, "w1:p1")).toBe("/home/sam/proj");
  expect(paneFolder(SNAP, "w2:p1")).toBe("/home/sam/other");
  expect(paneFolder(SNAP, "nope")).toBeUndefined();
  expect(paneFolder(undefined, "w1:p1")).toBeUndefined();
});

describe("runCommand", () => {
  function fakeRpc() {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    return {
      calls,
      call: async (_m: string, p: { method: string; params: Record<string, unknown> }) => {
        calls.push(p);
        if (p.method === "workspace.create" || p.method === "tab.create") return { root_pane: { pane_id: "w9:p1" } } as never;
        if (p.method === "pane.process_info") return { process_info: { shell_pid: 41, foreground_process_group_id: 41 } } as never;
        return {} as never;
      },
    };
  }

  test("a_new_shell_opens_as_a_tab_of_the_workspace_of_the_folder", async () => {
    const rpc = fakeRpc();
    await expect(runCommand(rpc, SNAP, { kind: "new", cwd: "/home/sam/proj" }, "ls\npwd")).resolves.toEqual({ paneId: "w9:p1" });
    expect(rpc.calls.map((c) => c.method)).toEqual(["workspace.get", "tab.create", "pane.process_info", "pane.send_input"]);
    expect(rpc.calls[1].params).toEqual({ workspace_id: "w1", cwd: "/home/sam/proj", focus: false });
    expect(rpc.calls.at(-1)!.params).toEqual({ pane_id: "w9:p1", text: "ls\npwd", keys: ["enter"] });
  });

  test("a_new_shell_in_a_new_folder_gets_a_new_workspace", async () => {
    const rpc = fakeRpc();
    await runCommand(rpc, SNAP, { kind: "new", cwd: "/home/sam/fresh" }, "ls");
    expect(rpc.calls[0]).toEqual({ method: "workspace.create", params: { cwd: "/home/sam/fresh", label: "fresh", focus: false } });
  });

  test("an_existing_terminal_gets_the_text_and_enter", async () => {
    const rpc = fakeRpc();
    await expect(runCommand(rpc, SNAP, { kind: "pane", paneId: "w2:p1" }, "make")).resolves.toEqual({ paneId: "w2:p1" });
    expect(rpc.calls).toEqual([{ method: "pane.send_input", params: { pane_id: "w2:p1", text: "make", keys: ["enter"] } }]);
  });
});
