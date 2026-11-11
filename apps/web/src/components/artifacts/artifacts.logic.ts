import type {
  ClaudeArtifact,
  ClaudeArtifactsAccount,
  EnvironmentId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

/** One Claude provider instance as one environment reports it. */
export interface ClaudeInstanceRow {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
  /** What the environment's server knows about the login; absent when it could not say. */
  readonly account: ClaudeArtifactsAccount | undefined;
}

export interface ClaudeAccountSource {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly environmentLabel: string;
}

export interface ClaudeAccountGroup {
  readonly key: string;
  readonly label: string;
  readonly email: string | undefined;
  readonly organizationName: string | undefined;
  /** Environments that can answer for this account, best first. */
  readonly sources: ReadonlyArray<ClaudeAccountSource>;
}

/**
 * Collapses instance rows from every environment into one entry per claude.ai account. Rows the
 * server could not identify stay separate, keyed by environment and instance, so none disappear.
 */
export function groupClaudeAccounts(
  rows: ReadonlyArray<ClaudeInstanceRow>,
  preferredEnvironmentId: EnvironmentId | null,
): ClaudeAccountGroup[] {
  const groups = new Map<string, ClaudeInstanceRow[]>();
  for (const row of rows) {
    const key = row.account?.accountKey ?? `${row.environmentId}:${row.instanceId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const rank = (row: ClaudeInstanceRow) =>
    (row.account?.listable === false ? 2 : 0) +
    (row.environmentId === preferredEnvironmentId ? 0 : 1);
  const accounts = [...groups].map(([key, members]) => {
    const ordered = members
      .map((row, index) => ({ row, index }))
      .toSorted((left, right) => rank(left.row) - rank(right.row) || left.index - right.index)
      .map(({ row }) => row);
    const best = ordered[0]!;
    return {
      key,
      label: best.displayName,
      email: ordered.find((row) => row.account?.email)?.account?.email,
      organizationName: ordered.find((row) => row.account?.organizationName)?.account
        ?.organizationName,
      sources: ordered.map(({ environmentId, instanceId, environmentLabel }) => ({
        environmentId,
        instanceId,
        environmentLabel,
      })),
    };
  });
  const labelCounts = new Map<string, number>();
  for (const account of accounts) {
    labelCounts.set(account.label, (labelCounts.get(account.label) ?? 0) + 1);
  }
  return accounts.map((account) =>
    (labelCounts.get(account.label) ?? 0) > 1 && account.organizationName
      ? { ...account, label: account.organizationName }
      : account,
  );
}

/**
 * Asks the account's sources in order and stops at the first that has not failed, so a healthy
 * account costs one request and a failing environment falls through to the next.
 */
export function pickAccountListing<A, E>(
  sources: ReadonlyArray<ClaudeAccountSource>,
  resultOf: (source: ClaudeAccountSource) => AsyncResult.AsyncResult<A, E>,
): {
  readonly source: ClaudeAccountSource | undefined;
  readonly result: AsyncResult.AsyncResult<A, E>;
} {
  let last: { source: ClaudeAccountSource; result: AsyncResult.AsyncResult<A, E> } | undefined;
  for (const source of sources) {
    const result = resultOf(source);
    if (!AsyncResult.isFailure(result)) return { source, result };
    last ??= { source, result };
  }
  return last ?? { source: undefined, result: AsyncResult.initial() };
}

/** Joins listings from several accounts; an artifact shared with both appears once. */
export function mergeArtifacts(
  lists: ReadonlyArray<ReadonlyArray<ClaudeArtifact>>,
): ClaudeArtifact[] {
  const byId = new Map<string, ClaudeArtifact>();
  for (const artifact of lists.flat()) {
    const existing = byId.get(artifact.id);
    if (
      existing === undefined ||
      (existing.relation === "shared" && artifact.relation === "mine")
    ) {
      byId.set(artifact.id, artifact);
    }
  }
  const time = (artifact: ClaudeArtifact) => Date.parse(artifact.updatedAt ?? "") || 0;
  return [...byId.values()].toSorted((left, right) => time(right) - time(left));
}
