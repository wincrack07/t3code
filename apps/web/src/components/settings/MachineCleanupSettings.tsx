import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  MachineCleanupItem,
  MachineCleanupReport,
  MachineCleanupSettings as CleanupSettings,
} from "@t3tools/contracts";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatBytes } from "../../lib/formatBytes";
import { useClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { formatChatTimestampTooltip, formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Switch } from "../ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
} from "../ui/alert-dialog";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

const ROW_DETAIL_CLASSNAME = "space-y-2 pt-2 pb-2 text-xs text-muted-foreground";
const SUMMARY_CLASSNAME = "cursor-pointer py-1 text-xs text-muted-foreground hover:text-foreground";
const JSON_CLASSNAME =
  "max-h-80 overflow-auto rounded-lg border border-border/60 p-3 font-mono text-xs text-foreground";

export function MachineCleanupSettings() {
  const { connectedEnvironments } = useSettingsScope();
  return (
    <>
      {connectedEnvironments
        .filter(
          (environment) =>
            environment.serverConfig?.environment.capabilities.machineCleanup === true,
        )
        .map((environment) => (
          <EnvironmentCleanup
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label}
            settings={environment.serverConfig!.settings.machineCleanup}
          />
        ))}
    </>
  );
}

function EnvironmentCleanup({
  environmentId,
  label,
  settings,
}: {
  environmentId: EnvironmentId;
  label: string;
  settings: CleanupSettings;
}) {
  const query = useAtomValue(serverEnvironment.machineCleanupState({ environmentId, input: {} }));
  const allowed = useAtomValue(serverEnvironment.scanMachineCleanup.permissionAtom(environmentId));
  const canConfigure = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const scan = useAtomCommand(serverEnvironment.scanMachineCleanup);
  const phaseA = useAtomCommand(serverEnvironment.runMachineCleanupPhaseA);
  const phaseB = useAtomCommand(serverEnvironment.deleteMachineCleanupApproved);
  const phaseC = useAtomCommand(serverEnvironment.runMachineCleanupPhaseC);
  const cancel = useAtomCommand(serverEnvironment.cancelMachineCleanup);
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const exportHistory = useAtomCommand(serverEnvironment.machineCleanupHistory);
  const [historyJson, setHistoryJson] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState<{
    phase: "B" | "C";
    reportId: string;
    items: readonly MachineCleanupItem[];
  } | null>(null);
  const state = query._tag === "Success" ? query.value : null;
  const report = state?.report;
  const busy = state?.running === true;
  const candidates =
    report?.items.filter((item) => item.phase === "B" && item.outcome === "pending") ?? [];
  const protectedItems =
    report?.items.filter((item) => item.outcome !== "pending" && item.outcome !== "removed") ?? [];
  const patch = (patch: Partial<CleanupSettings>) =>
    void update({ environmentId, input: { patch: { machineCleanup: { ...settings, ...patch } } } });
  const aRules = [
    ...new Set([
      ...(report?.items.filter((item) => item.phase === "A").map((item) => item.rule) ?? []),
      ...settings.enabledRules.filter((rule) => rule !== "*").map((rule) => rule.replace(/^!/, "")),
    ]),
  ].filter((rule) => rule !== "project");
  const timestampFormat = useClientSettings((value) => value.timestampFormat);
  const nowMinute = useNowMinute();
  const lastRunAt = report ? (report.finishedAt ?? report.startedAt) : null;
  const history = [...(state?.history ?? [])].reverse();
  const minimum = history.length ? Math.min(...history.map((entry) => entry.freeAfter)) : 0;
  const maximum = Math.max(...history.map((entry) => entry.freeAfter), 1);
  const points = history
    .map(
      (entry, index) =>
        `${10 + (index / Math.max(1, history.length - 1)) * 380},${90 - ((entry.freeAfter - minimum) / Math.max(1, maximum - minimum)) * 80}`,
    )
    .join(" ");
  return (
    <SettingsSection id={`machine-cleanup-${environmentId}`} title={`Machine cleanup · ${label}`}>
      <SettingsRow
        title="Free space"
        description={
          report && lastRunAt ? (
            <>
              Last run{" "}
              <Tooltip>
                <TooltipTrigger render={<time dateTime={lastRunAt} />}>
                  {formatRelativeTimeLabel(lastRunAt, Date.parse(`${nowMinute}:00.000Z`))}
                </TooltipTrigger>
                <TooltipPopup>
                  {formatChatTimestampTooltip(lastRunAt, timestampFormat)}
                </TooltipPopup>
              </Tooltip>
              . {formatBytes(report.freeBefore)} → {formatBytes(report.freeAfter)} free on{" "}
              {report.measurementPath}
            </>
          ) : (
            "Scan to measure this environment and review cleanup candidates."
          )
        }
        control={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!allowed || busy}
              onClick={() => {
                setSelected([]);
                void scan({ environmentId, input: {} });
              }}
            >
              Scan
            </Button>
            <Button
              size="sm"
              disabled={!allowed || busy}
              onClick={() => void phaseA({ environmentId, input: {} })}
            >
              Clean regenerable files now
            </Button>
            {busy && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void cancel({ environmentId, input: {} })}
              >
                Cancel
              </Button>
            )}
          </div>
        }
      >
        <div className={ROW_DETAIL_CLASSNAME}>
          {state?.freeNow !== undefined && (
            <p className="text-foreground tabular-nums">
              {formatBytes(state.freeNow)} available now
            </p>
          )}
          {busy && <p role="status">{state?.progress || "Scanning…"}</p>}
          {!busy && state?.progress && <p role="status">{state.progress}</p>}
          {history.length > 1 && (
            <svg
              role="img"
              aria-label="Free disk space over cleanup history"
              viewBox="0 0 400 100"
              preserveAspectRatio="none"
              className="h-12 w-full"
            >
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                points={points}
              />
            </svg>
          )}
        </div>
      </SettingsRow>
      {report && (
        <SettingsRow
          title="Cleanup report"
          description="Measured space freed, plus estimates for items you can review."
        >
          <div className={ROW_DETAIL_CLASSNAME}>
            <div className="-mx-2 tabular-nums">
              <CleanupReportSummary report={report} />
            </div>
            <details>
              <summary className={SUMMARY_CLASSNAME}>Regenerable files and skips</summary>
              <ul className="space-y-1 pt-1">
                {report.items
                  .filter((item) => item.phase === "A")
                  .map((item) => (
                    <li key={item.id} className="break-all">
                      {item.path} · {formatBytes(item.bytes)} · {item.reason || item.effect}
                    </li>
                  ))}
              </ul>
            </details>
          </div>
        </SettingsRow>
      )}
      <SettingsRow
        title="History JSON"
        description="The latest 100 reports are retained on this environment. Full history is loaded only when requested."
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={!allowed || busy}
            onClick={async () => {
              const result = await exportHistory({ environmentId, input: {} });
              if (result._tag === "Success") setHistoryJson(JSON.stringify(result.value, null, 2));
            }}
          >
            View history JSON
          </Button>
        }
      >
        {historyJson && (
          <div className={ROW_DETAIL_CLASSNAME}>
            <pre className={JSON_CLASSNAME}>{historyJson}</pre>
          </div>
        )}
      </SettingsRow>
      <SettingsRow
        title="Project roots"
        description="One absolute path or ~/path per line. Scanned to depth seven."
        control={
          <Textarea
            className="w-full sm:w-64"
            aria-label="Cleanup project roots"
            disabled={!canConfigure || !allowed || busy}
            defaultValue={settings.projectRoots.join("\n")}
            key={settings.projectRoots.join("\n")}
            onBlur={(event) =>
              patch({
                projectRoots: event.target.value
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        }
      />
      <SettingsRow
        title="Protected paths"
        description="These paths and everything inside them are always retained."
        control={
          <Textarea
            className="w-full sm:w-64"
            aria-label="Cleanup protected paths"
            disabled={!canConfigure || !allowed || busy}
            defaultValue={settings.protectedPaths.join("\n")}
            key={settings.protectedPaths.join("\n")}
            onBlur={(event) =>
              patch({
                protectedPaths: event.target.value
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        }
      />
      <SettingsRow
        title="Inactivity days"
        description="Both source files and the last commit must be older than this."
        control={
          <Input
            size="sm"
            className="w-full sm:w-32"
            aria-label="Cleanup inactivity days"
            type="number"
            min={1}
            max={3650}
            disabled={!canConfigure || !allowed || busy}
            defaultValue={settings.inactivityDays}
            key={settings.inactivityDays}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 1 && value <= 3650)
                patch({ inactivityDays: value });
            }}
          />
        }
      />
      <SettingsRow
        title="Daily unattended cleanup"
        description="Run regenerable cleanup only, once per local day. Approval candidates remain untouched."
        control={
          <Switch
            aria-label="Daily machine cleanup"
            checked={settings.scheduleEnabled}
            disabled={!canConfigure || !allowed || busy}
            onCheckedChange={(checked) => patch({ scheduleEnabled: checked })}
          />
        }
      />
      <SettingsRow
        title="Daily cleanup time"
        description="Local time on this environment. A missed run starts when the server next becomes available."
        control={
          <Input
            size="sm"
            className="w-full sm:w-32"
            type="time"
            aria-label="Daily cleanup time"
            value={settings.scheduleTime}
            disabled={!canConfigure || !allowed || busy}
            onChange={(event) => {
              if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.target.value))
                patch({ scheduleTime: event.target.value });
            }}
          />
        }
      />
      <SettingsRow
        title="Low-space alert"
        description="Notify below this many GiB, even when no approval candidates exist. Notification delivery depends on the environment's native notification service."
        control={
          <Input
            size="sm"
            className="w-full sm:w-32"
            type="number"
            aria-label="Low-space threshold GiB"
            min={0}
            max={10000}
            defaultValue={settings.lowSpaceGiB}
            key={settings.lowSpaceGiB}
            disabled={!canConfigure || !allowed || busy}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0 && value <= 10000)
                patch({ lowSpaceGiB: value });
            }}
          />
        }
      />
      {aRules.map((rule) => (
        <SettingsRow
          key={rule}
          title={rule}
          description="Regenerable files only. Active builds are retained."
          control={
            <Switch
              aria-label={`Enable cleanup rule ${rule}`}
              disabled={!canConfigure || !allowed || busy}
              checked={
                !settings.enabledRules.includes(`!${rule}`) &&
                (settings.enabledRules.includes("*") || settings.enabledRules.includes(rule))
              }
              onCheckedChange={(checked) =>
                patch({
                  enabledRules: checked
                    ? [
                        ...new Set([
                          ...settings.enabledRules.filter((value) => value !== `!${rule}`),
                          rule,
                        ]),
                      ]
                    : [
                        ...settings.enabledRules.filter(
                          (value) => value !== rule && value !== `!${rule}`,
                        ),
                        `!${rule}`,
                      ],
                })
              }
            />
          }
        />
      ))}
      <SettingsRow
        title="Awaiting your approval"
        description="Select exact paths to remove. Probably active worktrees are best kept. Every selection is checked again before deletion."
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={!allowed || busy || !candidates.some((item) => selected.includes(item.id))}
            onClick={() => {
              if (!report) return;
              setConfirming({
                phase: "B",
                reportId: report.id,
                items: candidates.filter((item) => selected.includes(item.id)),
              });
            }}
          >
            Delete selected
          </Button>
        }
      >
        {candidates.map((item) => (
          <SettingsRow
            key={item.id}
            title={item.path}
            description={`${formatBytes(item.bytes)}${item.probablyActive ? " · Probably active. Recommend keeping" : ""}`}
            control={
              <Checkbox
                aria-label={`Select ${item.path}`}
                checked={selected.includes(item.id)}
                disabled={!allowed || busy}
                onCheckedChange={(checked) =>
                  setSelected((value) =>
                    checked ? [...value, item.id] : value.filter((id) => id !== item.id),
                  )
                }
              />
            }
          />
        ))}
      </SettingsRow>
      {report?.items
        .filter((item) => item.phase === "C" && item.outcome === "pending")
        .map((item) => (
          <SettingsRow
            key={item.id}
            title={item.rule}
            description={`${item.path} · ${formatBytes(item.bytes)}. ${item.effect}`}
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={!allowed || busy}
                onClick={() => {
                  if (report) setConfirming({ phase: "C", reportId: report.id, items: [item] });
                }}
              >
                Review aggressive cleanup
              </Button>
            }
          />
        ))}
      {protectedItems.length > 0 && (
        <SettingsRow
          title="Retained files and worktrees"
          description="Dirty worktrees and protected or active paths are never removed."
        >
          <ul className={ROW_DETAIL_CLASSNAME}>
            {protectedItems.map((item) => (
              <li key={item.id} className="break-all">
                {item.path}
                {item.branch ? ` · ${item.branch}` : ""}
                {item.changes ? ` · ${item.changes} changes` : ""} · {item.reason}
              </li>
            ))}
          </ul>
        </SettingsRow>
      )}
      {[...new Set(report?.notes ?? [])].map((note) => (
        <p key={note} className="break-all px-3 py-3 text-xs text-muted-foreground sm:px-4">
          {note}
        </p>
      ))}
      {report && (
        <SettingsRow
          title="Report JSON"
          description="Includes exact paths, measurements, outcomes and operational notes."
        >
          <details className={ROW_DETAIL_CLASSNAME}>
            <summary className={SUMMARY_CLASSNAME}>View JSON</summary>
            <pre className={JSON_CLASSNAME}>{JSON.stringify(report, null, 2)}</pre>
          </details>
        </SettingsRow>
      )}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove these files on {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Only the paths below are approved. Changed, active, dirty or protected items will be
              retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1 px-6 pb-4 text-sm text-muted-foreground">
            {confirming?.items.map((item) => (
              <li key={item.id} className="break-all">
                {item.path} · {formatBytes(item.bytes)} · {item.effect}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={!allowed || busy}
              onClick={() => {
                if (!report || !confirming) return;
                const command = confirming.phase === "B" ? phaseB : phaseC;
                void command({
                  environmentId,
                  input: {
                    reportId: confirming.reportId,
                    itemIds: confirming.items.map((item) => item.id),
                  },
                });
                setConfirming(null);
                setSelected([]);
              }}
            >
              Remove approved files
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}

function cleanupCategory(item: MachineCleanupItem) {
  return item.rule === "worktree"
    ? "Worktrees"
    : item.rule === "node-modules" || item.rule === "pods"
      ? "Dependencies"
      : item.project
        ? "Builds"
        : "Caches";
}
function CleanupReportSummary({ report }: { report: MachineCleanupReport }) {
  const categories = [...new Set(report.items.map(cleanupCategory))];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Freed in A</TableHead>
          <TableHead className="text-right">Pending in B</TableHead>
          <TableHead className="text-right">In C</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((category) => {
          const items = report.items.filter((item) => cleanupCategory(item) === category);
          const ids = new Set(items.map((item) => item.id));
          const freed = (report.measurements ?? [])
            .filter((entry) => entry.phase === "A" && ids.has(entry.itemId))
            .reduce((sum, entry) => sum + Math.max(0, entry.after - entry.before), 0);
          const bytes = (phase: "B" | "C") =>
            items
              .filter((item) => item.phase === phase && item.outcome === "pending")
              .reduce((sum, item) => sum + item.bytes, 0);
          return (
            <TableRow key={category}>
              <TableCell>{category}</TableCell>
              <TableCell className="text-right">{formatBytes(freed)}</TableCell>
              <TableCell className="text-right">{formatBytes(bytes("B"))}</TableCell>
              <TableCell className="text-right">{formatBytes(bytes("C"))}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
