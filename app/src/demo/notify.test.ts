jest.mock("expo-notifications", () => ({}));

import { demoContent } from "./notify";

describe("demoContent", () => {
  it("a needs-you notice with a Yes and No menu gets the choice buttons", () => {
    const content = demoContent({
      kind: "needs_you",
      paneId: "p2",
      title: "Codex needs you · api-server",
      body: "Allow Codex to run `pnpm add zod`?",
      choices: ["Yes", "Yes, and don't ask again for pnpm add", "No, and tell Codex what to do differently"],
    });
    expect(content).toEqual({
      title: "Codex needs you · api-server",
      body: "Allow Codex to run `pnpm add zod`?\nYes · No, and tell Codex what to do differently",
      data: {
        hostId: "demo",
        paneId: "p2",
        choice: { yes: { key: "1", label: "Yes" }, no: { key: "3", label: "No, and tell Codex what to do differently" }, revision: 0 },
      },
      categoryIdentifier: "herdling_choice",
    });
  });

  it("a finished notice has no buttons", () => {
    expect(demoContent({ kind: "finished", paneId: "p3", title: "Pi finished", body: "Done", choices: ["Yes", "No"] })).toEqual({
      title: "Pi finished",
      body: "Done",
      data: { hostId: "demo", paneId: "p3" },
    });
  });
});
