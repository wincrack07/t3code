import { EnvironmentId, ProviderInstanceId, type ClaudeArtifact } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_VIEWER_HISTORY,
  accountBrowserProfileId,
  filterArtifacts,
  groupClaudeAccounts,
  mergeArtifacts,
  stepHistory,
  visitInHistory,
  pickAccountListing,
  type ClaudeInstanceRow,
} from "./artifacts.logic";

const mac = EnvironmentId.make("mac");
const vps = EnvironmentId.make("vps");
const box = EnvironmentId.make("box");
const lab = EnvironmentId.make("lab");
const work = ProviderInstanceId.make("claude_work");
const personal = ProviderInstanceId.make("claude_personal");

const row = (
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId,
  account: Partial<NonNullable<ClaudeInstanceRow["account"]>> | undefined,
): ClaudeInstanceRow => ({
  environmentId,
  environmentLabel: environmentId,
  instanceId,
  displayName:
    instanceId === work ? "Claude · Invu-Clau · Suscripción" : "Claude · Personal · Suscripción",
  email: "me@example.com",
  account:
    account === undefined
      ? undefined
      : { instanceId, listable: true, email: "me@example.com", ...account },
});

const artifact = (id: string, relation: "mine" | "shared", updatedAt: string): ClaudeArtifact => ({
  id,
  url: `https://claude.ai/code/artifact/${id}`,
  title: id,
  relation,
  isPublic: false,
  updatedAt,
});

describe("groupClaudeAccounts", () => {
  it("shows two accounts reached through four environments as two entries", () => {
    const rows = [mac, vps, box, lab].flatMap((environmentId) => [
      row(environmentId, work, {
        accountKey: "work-key",
        organizationName: "Work Org",
        listable: environmentId !== mac,
      }),
      row(environmentId, personal, { accountKey: "personal-key", organizationName: "Mine" }),
    ]);
    const accounts = groupClaudeAccounts(rows, mac);
    expect(accounts.map((account) => [account.key, account.label, account.email])).toEqual([
      ["work-key", "Invu-Clau", "me@example.com"],
      ["personal-key", "Personal", "me@example.com"],
    ]);
    // The active environment answers first when it can; one that cannot read the login goes last.
    expect(accounts[0]?.sources.map((source) => source.environmentId)).toEqual([
      vps,
      box,
      lab,
      mac,
    ]);
    expect(accounts[1]?.sources.map((source) => source.environmentId)).toEqual([
      mac,
      vps,
      box,
      lab,
    ]);
  });

  it("keeps same-e-mail accounts in different organizations apart and labels them by organization", () => {
    const accounts = groupClaudeAccounts(
      [
        {
          ...row(vps, work, { accountKey: "a", organizationName: "Org A" }),
          displayName: "Claude",
        },
        {
          ...row(vps, personal, { accountKey: "b", organizationName: "Org B" }),
          displayName: "Claude",
        },
      ],
      null,
    );
    expect(accounts.map((account) => account.label)).toEqual(["Org A", "Org B"]);
  });

  it("merges an environment that cannot identify the account by instance name and e-mail", () => {
    const accounts = groupClaudeAccounts(
      [
        row(vps, work, undefined),
        row(box, work, { accountKey: "work-key" }),
        row(box, personal, undefined),
        row(lab, personal, undefined),
      ],
      null,
    );
    expect(accounts.map((account) => [account.label, account.sources.length])).toEqual([
      ["Invu-Clau", 2],
      ["Personal", 2],
    ]);
    expect(accounts[0]?.key).toBe("work-key");
  });

  it("keeps instances with neither identity nor e-mail per environment so none disappear", () => {
    const accounts = groupClaudeAccounts(
      [
        { ...row(vps, work, undefined), email: undefined },
        { ...row(box, work, undefined), email: undefined },
      ],
      null,
    );
    expect(accounts.map((account) => account.key)).toEqual(["vps:claude_work", "box:claude_work"]);
  });
});

describe("pickAccountListing", () => {
  const sources = [vps, box, lab].map((environmentId) => ({
    environmentId,
    instanceId: work,
    environmentLabel: environmentId,
  }));

  it("falls through a failing environment and stops at the first that answers", () => {
    const asked: EnvironmentId[] = [];
    const picked = pickAccountListing(sources, (source) => {
      asked.push(source.environmentId);
      return source.environmentId === vps
        ? AsyncResult.failure(Cause.fail("expired"))
        : AsyncResult.success("listing");
    });
    expect(picked.source?.environmentId).toBe(box);
    expect(AsyncResult.isSuccess(picked.result)).toBe(true);
    expect(asked).toEqual([vps, box]);
  });

  it("waits on a pending source instead of asking the next", () => {
    const asked: EnvironmentId[] = [];
    const picked = pickAccountListing(sources, (source) => {
      asked.push(source.environmentId);
      return AsyncResult.initial(true);
    });
    expect(picked.source?.environmentId).toBe(vps);
    expect(asked).toEqual([vps]);
  });

  it("reports the best source's failure when every source fails", () => {
    const picked = pickAccountListing(sources, (source) =>
      AsyncResult.failure(Cause.fail(source.environmentId)),
    );
    expect(picked.source?.environmentId).toBe(vps);
    expect(AsyncResult.isFailure(picked.result)).toBe(true);
  });
});

describe("mergeArtifacts", () => {
  it("lists an artifact once across accounts under the account that owns it, newest first", () => {
    const merged = mergeArtifacts([
      {
        accountKey: "personal",
        artifacts: [
          artifact("a", "shared", "2026-11-01T00:00:00Z"),
          artifact("b", "mine", "2026-11-03T00:00:00Z"),
        ],
      },
      { accountKey: "work", artifacts: [artifact("a", "mine", "2026-11-01T00:00:00Z")] },
    ]);
    expect(
      merged.map((entry) => [entry.artifact.id, entry.artifact.relation, entry.accountKey]),
    ).toEqual([
      ["b", "mine", "personal"],
      ["a", "mine", "work"],
    ]);
  });
});

describe("filterArtifacts", () => {
  const entries = mergeArtifacts([
    {
      accountKey: "k",
      artifacts: [
        { ...artifact("1", "mine", "2026-11-03T00:00:00Z"), title: "zeta chart" },
        {
          ...artifact("2", "shared", "2026-11-02T00:00:00Z"),
          title: "Alpha",
          description: "Quarterly chart",
        },
        { ...artifact("3", "mine", "2026-11-01T00:00:00Z"), title: "beta 10" },
        { ...artifact("4", "mine", "2026-10-01T00:00:00Z"), title: "Beta 9" },
      ],
    },
  ]);
  const ids = (list: ReadonlyArray<{ artifact: ClaudeArtifact }>) =>
    list.map((entry) => entry.artifact.id);

  it("searches titles and descriptions, filters by owner and sorts", () => {
    expect(
      ids(filterArtifacts(entries, { relation: "all", query: " CHART ", sort: "updated" })),
    ).toEqual(["1", "2"]);
    expect(
      ids(filterArtifacts(entries, { relation: "shared", query: "", sort: "updated" })),
    ).toEqual(["2"]);
    expect(ids(filterArtifacts(entries, { relation: "mine", query: "", sort: "title" }))).toEqual([
      "4",
      "3",
      "1",
    ]);
  });
});

describe("viewer history", () => {
  it("moves back and forward, and a new visit drops the forward entries", () => {
    let history = ["a", "b", "c"].reduce(visitInHistory, EMPTY_VIEWER_HISTORY);
    history = stepHistory(stepHistory(history, -1), -1);
    expect(history.urls[history.index]).toBe("a");
    expect(stepHistory(history, -1)).toBe(history);
    expect(visitInHistory(history, "a")).toBe(history);
    history = visitInHistory(history, "d");
    expect(history).toEqual({ urls: ["a", "d"], index: 1 });
    expect(stepHistory(history, 1)).toBe(history);
  });
});

describe("accountBrowserProfileId", () => {
  it("is stable per account and a valid profile id", () => {
    expect(accountBrowserProfileId("work-key")).toBe(accountBrowserProfileId("work-key"));
    expect(accountBrowserProfileId("work-key")).not.toBe(accountBrowserProfileId("personal-key"));
    expect(accountBrowserProfileId("name:x\0y")).toMatch(/^claude-account-[0-9a-f]{8}$/);
  });
});
