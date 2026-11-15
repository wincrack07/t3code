import { describe, expect, it } from "vite-plus/test";

import {
  draftFor,
  emptyDraft,
  joinCommandLine,
  serverFromDraft,
  splitCommandLine,
} from "./McpCatalogSettings.logic";

describe("command lines", () => {
  it.each([
    [
      "npx -y @modelcontextprotocol/server-github",
      ["npx", "-y", "@modelcontextprotocol/server-github"],
    ],
    [
      `node "/Users/me/My Tools/server.js" --flag`,
      ["node", "/Users/me/My Tools/server.js", "--flag"],
    ],
    [`uvx mcp-server --name 'two words' ""`, ["uvx", "mcp-server", "--name", "two words", ""]],
    [String.raw`run a\ b "say \"hi\""`, ["run", "a b", 'say "hi"']],
  ])("splits %s", (line, words) => {
    expect(splitCommandLine(line)).toEqual(words);
    expect(splitCommandLine(joinCommandLine(words))).toEqual(words);
  });
});

describe("serverFromDraft", () => {
  it("keeps a stored secret blank so the server keeps its value", () => {
    const draft = draftFor({
      id: "github",
      name: "GitHub",
      enabled: true,
      transport: { type: "stdio", command: "npx", args: ["-y", "github-mcp"] },
      env: [
        { name: "GITHUB_TOKEN", value: "", secret: true, stored: true },
        { name: "MODE", value: "fast", secret: false },
      ],
      headers: [],
    });
    expect(serverFromDraft({ ...draft, name: "GitHub work" }, false)).toEqual({
      server: {
        id: "github",
        name: "GitHub work",
        enabled: false,
        transport: { type: "stdio", command: "npx", args: ["-y", "github-mcp"] },
        env: [
          { name: "GITHUB_TOKEN", value: "", secret: true, stored: true },
          { name: "MODE", value: "fast", secret: false },
        ],
        headers: [],
      },
    });
  });

  it("derives the id from the name until it is edited, and refuses what cannot run", () => {
    const draft = { ...emptyDraft(), name: "Linear Tasks", type: "http" as const };
    expect(serverFromDraft(draft, true)).toEqual({
      error: "Enter a full URL, such as https://example.com/mcp.",
    });
    expect(serverFromDraft({ ...draft, url: "https://mcp.linear.app/mcp" }, true)).toMatchObject({
      server: {
        id: "linear-tasks",
        transport: { type: "http", url: "https://mcp.linear.app/mcp" },
      },
    });
    expect(serverFromDraft({ ...draft, id: "Bad Id" }, true)).toMatchObject({
      error: expect.any(String),
    });
    expect(serverFromDraft({ ...emptyDraft(), name: "x" }, true)).toEqual({
      error: "Enter the command that starts the server.",
    });
  });
});
