import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { isProviderUpdateActive } from "../ProviderUpdateLaunchNotification.logic";
import type { useProviderUpdates } from "../ProviderUpdatesAction";
import {
  getProviderVersionAdvisoryPresentation,
  getProviderVersionLabel,
} from "../settings/providerStatus";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const VISIBLE_ROW_LIMIT = 5;

type ProviderUpdates = ReturnType<typeof useProviderUpdates>;
type Listing = ProviderUpdates["listed"][number];

/** Rows in display order, capped, grouped by machine only when several machines have updates. */
function resolveProviderUpdateRows(listed: ProviderUpdates["listed"]) {
  const rows = listed.flatMap((machine) =>
    machine.candidates.map((listing) => ({ machine, ...listing })),
  );
  const visible = rows.slice(0, VISIBLE_ROW_LIMIT);
  const groups: Array<{ machine: Listing; rows: typeof visible }> = [];
  for (const row of visible) {
    const last = groups.at(-1);
    if (last?.machine.environmentId === row.machine.environmentId) last.rows.push(row);
    else groups.push({ machine: row.machine, rows: [row] });
  }
  return { groups, hiddenCount: rows.length - visible.length, grouped: listed.length > 1 };
}

function rowKey(row: { machine: Listing; candidate: Listing["candidates"][number]["candidate"] }) {
  return `${row.machine.environmentId}\n${row.candidate.instanceId}`;
}

export function SidebarUpdateProviders({
  updates,
  checking,
}: {
  readonly updates: ProviderUpdates;
  readonly checking: boolean;
}) {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const { groups, hiddenCount, grouped } = resolveProviderUpdateRows(updates.listed);
  const unchecked = updates.uncheckedMachineCount;
  const status =
    groups.length > 0
      ? null
      : checking
        ? "Checking providers…"
        : unchecked === 0 && updates.checkedAt !== null
          ? "Providers are up to date"
          : null;
  if (groups.length === 0 && status === null && unchecked === 0) return null;

  const update = async (row: Parameters<typeof rowKey>[0]) => {
    const key = rowKey(row);
    setPending((current) => new Set(current).add(key));
    await settlePromise(() =>
      updates.updateAll({
        only: { environmentId: row.machine.environmentId, instanceId: row.candidate.instanceId },
      }),
    );
    setPending((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  return (
    <section
      aria-label="Provider updates"
      className="mt-2 shrink-0 border-t border-border/60 px-1 pt-2"
    >
      <div className="flex items-center justify-between gap-3 text-xs leading-5">
        <h3 className="font-medium text-muted-foreground">Providers</h3>
        {!grouped && groups[0] ? (
          <span className="min-w-0 truncate text-muted-foreground">{groups[0].machine.label}</span>
        ) : null}
      </div>
      {groups.map((group) => (
        <div key={group.machine.environmentId}>
          {grouped ? (
            <div className="mt-1 truncate text-2xs leading-4 text-muted-foreground">
              {group.machine.label}
            </div>
          ) : null}
          {group.rows.map((row) => {
            const { candidate } = row;
            const key = rowKey(row);
            const name = PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver;
            const from = getProviderVersionLabel(candidate.installedVersion ?? candidate.version);
            const to = getProviderVersionLabel(candidate.versionAdvisory.latestVersion);
            const isPending = pending.has(key);
            const reason = getProviderVersionAdvisoryPresentation(
              candidate.versionAdvisory,
              candidate.compatibilityAdvisory,
            )?.detail;
            return (
              <div className="flex h-7 min-w-0 items-center gap-2 text-xs" key={key}>
                <span className="shrink-0 text-popover-foreground">{name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground tabular-nums">
                  {from ? `${from} → ${to}` : to}
                </span>
                {isPending || isProviderUpdateActive(candidate) ? (
                  <span className="shrink-0 text-muted-foreground">Updating…</span>
                ) : row.oneClick ? (
                  <Button
                    aria-label={`Update ${name} on ${row.machine.label}`}
                    size="micro"
                    variant="ghost-muted"
                    onClick={() => void update(row)}
                  >
                    Update
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="shrink-0 cursor-default text-muted-foreground" />}
                    >
                      Update manually
                    </TooltipTrigger>
                    {reason ? <TooltipPopup side="top">{reason}</TooltipPopup> : null}
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {hiddenCount > 0 ? (
        <Link
          className="inline-flex h-6 items-center rounded-sm text-xs text-muted-foreground underline-offset-2 outline-none transition-colors hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          to="/settings/providers"
        >
          {`${hiddenCount} more in Settings → Providers`}
        </Link>
      ) : null}
      {status ? <p className="py-1 text-xs leading-5 text-muted-foreground">{status}</p> : null}
      {unchecked > 0 ? (
        <p className="py-1 text-xs leading-5 text-muted-foreground">
          {`${unchecked} ${unchecked === 1 ? "machine" : "machines"} not checked`}
        </p>
      ) : null}
    </section>
  );
}
