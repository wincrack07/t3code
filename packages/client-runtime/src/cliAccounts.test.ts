import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ManagedPolicySummary,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  cliAccountLoginCommand,
  defaultCliAccountHome,
  planCliAccountAdd,
  suggestCliAccountColor,
  type CliAccountDriver,
} from "./cliAccounts.ts";

const codex = ProviderDriverKind.make("codex");
const taken = ProviderInstanceId.make("codex_invu");

describe("planCliAccountAdd", () => {
  const plan = (driver: CliAccountDriver, name: string, home: string, accentColor?: string) =>
    planCliAccountAdd({
      driver,
      providerInstances: { [taken]: { driver: codex } } as ServerSettings["providerInstances"],
      policy: undefined,
      name,
      home,
      accentColor,
    });

  it("adds a Codex account on its own CODEX_HOME with the CLI's own login", () => {
    expect(plan("codex", " Invu ", " ~/.codex-company ", "#2b68ef")).toEqual({
      mutation: {
        operation: "create",
        instanceId: "codex_invu_2",
        instance: {
          driver: "codex",
          enabled: true,
          displayName: "Codex - Invu",
          accentColor: "#2b68ef",
          config: { setupMode: "existing", homePath: "~/.codex-company" },
        },
      },
    });
  });

  it("adds a Claude account on its own config folder", () => {
    expect(plan("claudeAgent", "Invu", "~/.claude-company")).toEqual({
      mutation: {
        operation: "create",
        instanceId: "claudeAgent_invu",
        instance: {
          driver: "claudeAgent",
          enabled: true,
          displayName: "Claude - Invu",
          config: { homePath: "~/.claude-company" },
        },
      },
    });
  });

  it.each([
    ["codex", "Invu", ""],
    ["codex", "", "~/.codex-company"],
    ["codex", "Invu", "~/.codex"],
    ["codex", "Invu", "$HOME/.codex/"],
    ["claudeAgent", "Invu", "~/.claude"],
  ] as const)("refuses %s name %j folder %j", (driver, name, home) => {
    expect(plan(driver, name, home)).toHaveProperty("error");
  });

  it("refuses an id the organization manages", () => {
    const policy = {
      organization: "Acme",
      lockedSettings: ["providerInstances.codex_work"],
    } as unknown as ManagedPolicySummary;
    expect(
      planCliAccountAdd({
        driver: "codex",
        providerInstances: {},
        policy,
        name: "Work",
        home: "~/.codex-work",
      }),
    ).toEqual({ error: "Managed by Acme." });
  });
});

describe("suggestCliAccountColor", () => {
  it("reuses the colour of the same account on another provider", () => {
    const providerInstances = {
      claudeAgent: {
        driver: "claudeAgent",
        displayName: "Claude · Personal · Suscripción",
        accentColor: "#eb2525",
      },
      claudeAgent_work: {
        driver: "claudeAgent",
        displayName: "Claude · Invu-Clau · Suscripción",
        accentColor: "#2b68ef",
      },
      codex: { driver: "codex", displayName: "Codex - Invu" },
    } as unknown as ServerSettings["providerInstances"];
    expect(suggestCliAccountColor(providerInstances, "Invu")).toBe("#2b68ef");
    expect(suggestCliAccountColor(providerInstances, "personal")).toBe("#eb2525");
    expect(suggestCliAccountColor(providerInstances, "Acme")).toBeUndefined();
    expect(suggestCliAccountColor(providerInstances, " ")).toBeUndefined();
  });
});

describe("cliAccountLoginCommand", () => {
  it("signs Codex in with a device code in its own folder, after clearing that folder's login", () => {
    expect(cliAccountLoginCommand("codex", "~/.codex-company")).toBe(
      "mkdir -p ~/.codex-company && CODEX_HOME=~/.codex-company codex logout; CODEX_HOME=~/.codex-company codex login --device-auth",
    );
    expect(cliAccountLoginCommand("claudeAgent", "~/.claude-company")).toBe(
      "CLAUDE_CONFIG_DIR=~/.claude-company claude auth login",
    );
  });

  it("quotes folders with spaces without losing the home directory", () => {
    expect(cliAccountLoginCommand("claudeAgent", "~/My Accounts/claude")).toBe(
      `CLAUDE_CONFIG_DIR="$HOME"/'My Accounts/claude' claude auth login`,
    );
    expect(cliAccountLoginCommand("claudeAgent", "/opt/it's here")).toBe(
      `CLAUDE_CONFIG_DIR='/opt/it'\\''s here' claude auth login`,
    );
  });

  it("suggests a folder from the account name", () => {
    expect(defaultCliAccountHome("codex", "Invu Work")).toBe("~/.codex-invu-work");
    expect(defaultCliAccountHome("claudeAgent", "  ")).toBe("~/.claude-account");
  });
});
