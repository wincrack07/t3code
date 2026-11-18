import { useState } from "react";
import { msg, T, Var, useGT, useMessages } from "gt-react";
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
  const gt = useGT();
  const m = useMessages();
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
    <SettingsSection
      id={`machine-cleanup-${environmentId}`}
      title={gt("Machine cleanup · {label}", { label })}
    >
      <SettingsRow
        title={gt("Free space")}
        description={
          report && lastRunAt ? (
            <T>
              Last run{" "}
              <Tooltip>
                <TooltipTrigger render={<time dateTime={lastRunAt} />}>
                  <Var>
                    {formatRelativeTimeLabel(lastRunAt, Date.parse(`${nowMinute}:00.000Z`), m)}
                  </Var>
                </TooltipTrigger>
                <TooltipPopup>
                  <Var>{formatChatTimestampTooltip(lastRunAt, timestampFormat)}</Var>
                </TooltipPopup>
              </Tooltip>
              . <Var>{formatBytes(report.freeBefore)}</Var> →{" "}
              <Var>{formatBytes(report.freeAfter)}</Var> free on <Var>{report.measurementPath}</Var>
            </T>
          ) : (
            gt("Scan to measure this environment and review cleanup candidates.")
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
              <T $context="verb, button that scans the machine">Scan</T>
            </Button>
            <Button
              size="sm"
              disabled={!allowed || busy}
              onClick={() => void phaseA({ environmentId, input: {} })}
            >
              <T>Clean regenerable files now</T>
            </Button>
            {busy && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void cancel({ environmentId, input: {} })}
              >
                <T>Cancel</T>
              </Button>
            )}
          </div>
        }
      >
        <div className={ROW_DETAIL_CLASSNAME}>
          {state?.freeNow !== undefined && (
            <p className="text-foreground tabular-nums">
              <T>
                <Var>{formatBytes(state.freeNow)}</Var> available now
              </T>
            </p>
          )}
          {busy && <p role="status">{state?.progress || gt("Scanning…")}</p>}
          {!busy && state?.progress && <p role="status">{state.progress}</p>}
          {history.length > 1 && (
            <svg
              role="img"
              aria-label={gt("Free disk space over cleanup history")}
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
          title={gt("Cleanup report")}
          description={gt("Measured space freed, plus estimates for items you can review.")}
        >
          <div className={ROW_DETAIL_CLASSNAME}>
            <div className="-mx-2 tabular-nums">
              <CleanupReportSummary report={report} />
            </div>
            {report.taskAttachments ? (
              <TaskAttachmentUsageSummary usage={report.taskAttachments} />
            ) : null}
            <details>
              <summary className={SUMMARY_CLASSNAME}>
                <T>Regenerable files and skips</T>
              </summary>
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
        title={gt("History JSON")}
        description={gt(
          "The latest 100 reports are retained on this environment. Full history is loaded only when requested.",
        )}
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
            <T>View history JSON</T>
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
        title={gt("Project roots")}
        description={gt("One absolute path or ~/path per line. Scanned to depth seven.")}
        control={
          <Textarea
            className="w-full sm:w-64"
            aria-label={gt("Cleanup project roots")}
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
        title={gt("Protected paths")}
        description={gt("These paths and everything inside them are always retained.")}
        control={
          <Textarea
            className="w-full sm:w-64"
            aria-label={gt("Cleanup protected paths")}
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
        title={gt("Inactivity days")}
        description={gt("Both source files and the last commit must be older than this.")}
        control={
          <Input
            size="sm"
            className="w-full sm:w-32"
            aria-label={gt("Cleanup inactivity days")}
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
        title={gt("Daily unattended cleanup")}
        description={gt(
          "Run regenerable cleanup only, once per local day. Approval candidates remain untouched.",
        )}
        control={
          <Switch
            aria-label={gt("Daily machine cleanup")}
            checked={settings.scheduleEnabled}
            disabled={!canConfigure || !allowed || busy}
            onCheckedChange={(checked) => patch({ scheduleEnabled: checked })}
          />
        }
      />
      <SettingsRow
        title={gt("Daily cleanup time")}
        description={gt(
          "Local time on this environment. A missed run starts when the server next becomes available.",
        )}
        control={
          <Input
            size="sm"
            className="w-full sm:w-32"
            type="time"
            aria-label={gt("Daily cleanup time")}
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
        title={gt("Low-space alert")}
        description={gt(
          "Notify below this many GiB, even when no approval candidates exist. Notification delivery depends on the environment's native notification service.",
        )}
        control={
          <Input
            size="sm"
            className="w-full sm:w-32"
            type="number"
            aria-label={gt("Low-space threshold GiB")}
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
          description={gt("Regenerable files only. Active builds are retained.")}
          control={
            <Switch
              aria-label={gt("Enable cleanup rule {rule}", { rule })}
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
        title={gt("Awaiting your approval")}
        description={gt(
          "Select exact paths to remove. Probably active worktrees are best kept. Every selection is checked again before deletion.",
        )}
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
            <T>Delete selected</T>
          </Button>
        }
      >
        {candidates.map((item) => (
          <SettingsRow
            key={item.id}
            title={item.path}
            description={[
              formatBytes(item.bytes),
              isTaskAttachmentItem(item)
                ? item.project
                  ? gt("{label} in {project}", {
                      label: m(taskAttachmentLabel(item)),
                      project: item.project,
                    })
                  : m(taskAttachmentLabel(item))
                : null,
              item.probablyActive ? gt("Probably active. Recommend keeping") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            control={
              <Checkbox
                aria-label={gt("Select {path}", { path: item.path })}
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
            title={
              isTaskAttachmentItem(item)
                ? `${m(taskAttachmentLabel(item))}${item.project ? ` · ${item.project}` : ""}`
                : item.rule
            }
            description={`${item.path} · ${formatBytes(item.bytes)}. ${isTaskAttachmentItem(item) ? `${item.reason}. ` : ""}${item.effect}`}
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={!allowed || busy}
                onClick={() => {
                  if (report) setConfirming({ phase: "C", reportId: report.id, items: [item] });
                }}
              >
                <T>Review aggressive cleanup</T>
              </Button>
            }
          />
        ))}
      {protectedItems.length > 0 && (
        <SettingsRow
          title={gt("Retained files and worktrees")}
          description={gt("Dirty worktrees and protected or active paths are never removed.")}
        >
          <ul className={ROW_DETAIL_CLASSNAME}>
            {protectedItems.map((item) => (
              <li key={item.id} className="break-all">
                {item.path}
                {item.branch ? ` · ${item.branch}` : ""}
                {item.changes
                  ? ` · ${gt("{count, plural, one {{count} changes} other {{count} changes}}", { count: item.changes })}`
                  : ""}{" "}
                · {item.reason}
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
          title={gt("Report JSON")}
          description={gt("Includes exact paths, measurements, outcomes and operational notes.")}
        >
          <details className={ROW_DETAIL_CLASSNAME}>
            <summary className={SUMMARY_CLASSNAME}>
              <T>View JSON</T>
            </summary>
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
            <AlertDialogTitle>
              <T>
                Remove these files on <Var>{label}</Var>?
              </T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>
                Only the paths below are approved. Changed, active, dirty or protected items will be
                retained.
              </T>
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
            <AlertDialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
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
              <T>Remove approved files</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}

const isTaskAttachmentItem = (item: MachineCleanupItem) =>
  item.rule.startsWith("task-attachments-");
const TASK_ATTACHMENT_RULE_LABELS: Record<string, string> = {
  "task-attachments-open": msg("Open task's attachment copy"),
  "task-attachments-done": msg("Done task's attachment copy"),
  "task-attachments-orphaned": msg("Deleted task's attachment copy"),
};
const taskAttachmentLabel = (item: MachineCleanupItem) =>
  TASK_ATTACHMENT_RULE_LABELS[item.rule] ?? msg("Task attachment copy");

/** Stored copies of task attachments: done and deleted tasks' copies wait for approval; open ones are reviewed one by one. */
function TaskAttachmentUsageSummary({
  usage,
}: {
  usage: NonNullable<MachineCleanupReport["taskAttachments"]>;
}) {
  const gt = useGT();
  const rows = [
    { label: gt("Open tasks"), bucket: usage.open, note: gt("Reviewed one at a time") },
    { label: gt("Done tasks"), bucket: usage.done, note: gt("Awaiting your approval") },
    { label: gt("Deleted tasks"), bucket: usage.orphaned, note: gt("Awaiting your approval") },
  ];
  return (
    <div className="-mx-2 tabular-nums">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <T>Task attachments</T>
            </TableHead>
            <TableHead className="text-right">
              <T $context="table column: number of stored copies">Copies</T>
            </TableHead>
            <TableHead className="text-right">
              <T $context="table column: disk size">Size</T>
            </TableHead>
            <TableHead>
              <T $context="table column: what cleanup does with these copies">Cleanup</T>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="text-right">{row.bucket.count}</TableCell>
              <TableCell className="text-right">{formatBytes(row.bucket.bytes)}</TableCell>
              <TableCell>
                {row.bucket.count > 0
                  ? row.note
                  : gt("None", { $context: "no copies to clean up" })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function cleanupCategory(item: MachineCleanupItem) {
  if (isTaskAttachmentItem(item)) return msg("Task attachments");
  return item.rule === "worktree"
    ? msg("Worktrees")
    : item.rule === "node-modules" || item.rule === "pods"
      ? msg("Dependencies")
      : item.project
        ? msg("Builds", { $context: "cleanup category: build output" })
        : msg("Caches");
}
function CleanupReportSummary({ report }: { report: MachineCleanupReport }) {
  const m = useMessages();
  const categories = [...new Set(report.items.map(cleanupCategory))];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <T $context="table column">Category</T>
          </TableHead>
          <TableHead className="text-right">
            <T>Freed in A</T>
          </TableHead>
          <TableHead className="text-right">
            <T>Pending in B</T>
          </TableHead>
          <TableHead className="text-right">
            <T $context="table column: items in aggressive phase C">In C</T>
          </TableHead>
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
              <TableCell>{m(category)}</TableCell>
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
