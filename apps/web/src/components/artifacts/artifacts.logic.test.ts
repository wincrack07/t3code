import { EnvironmentId, ProviderInstanceId, type ClaudeArtifact } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import {
  groupClaudeAccounts,
  mergeArtifacts,
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
  displayName: instanceId === work ? "Work" : "Personal",
  account:
    account === undefined
      ? undefined
      : { instanceId, listable: true, email: "me@example.com", ...account },
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
      ["work-key", "Work", "me@example.com"],
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

  it("keeps unidentified instances per environment so nothing disappears", () => {
    const accounts = groupClaudeAccounts(
      [row(vps, work, undefined), row(box, work, undefined), row(box, personal, {})],
      null,
    );
    expect(accounts.map((account) => account.key)).toEqual([
      "vps:claude_work",
      "box:claude_work",
      "box:claude_personal",
    ]);
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
  const artifact = (
    id: string,
    relation: "mine" | "shared",
    updatedAt: string,
  ): ClaudeArtifact => ({
    id,
    url: `https://claude.ai/code/artifact/${id}`,
    title: id,
    relation,
    isPublic: false,
    updatedAt,
  });

  it("lists an artifact once across accounts, newest first", () => {
    const merged = mergeArtifacts([
      [
        artifact("a", "shared", "2026-11-01T00:00:00Z"),
        artifact("b", "mine", "2026-11-03T00:00:00Z"),
      ],
      [artifact("a", "mine", "2026-11-01T00:00:00Z")],
    ]);
    expect(merged.map((entry) => [entry.id, entry.relation])).toEqual([
      ["b", "mine"],
      ["a", "mine"],
    ]);
  });
});
