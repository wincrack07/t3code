import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  MachineCleanupItem,
  MachineCleanupSettings as CleanupSettings,
} from "@t3tools/contracts";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatBytes } from "../../lib/formatBytes";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
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
  const history = [...(state?.history ?? [])].reverse();
  const minimum = Math.min(...history.map((entry) => entry.freeAfter), 0);
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
          report
            ? `Last run: ${report.finishedAt ?? report.startedAt}. ${formatBytes(report.freeBefore)} → ${formatBytes(report.freeAfter)} on ${report.measurementPath}`
            : "Scan to measure this environment and review cleanup candidates."
        }
        control={
          <div className="flex gap-2">
            <Button
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
              disabled={!allowed || busy}
              onClick={() => void phaseA({ environmentId, input: {} })}
            >
              Clean regenerable files now
            </Button>
            {busy && (
              <Button variant="outline" onClick={() => void cancel({ environmentId, input: {} })}>
                Cancel
              </Button>
            )}
          </div>
        }
      >
        {busy && <p role="status">{state?.progress || "Scanning…"}</p>}
        {!busy && state?.progress && <p role="status">{state.progress}</p>}
        {history.length > 1 && (
          <svg role="img" aria-label="Free disk space over cleanup history" viewBox="0 0 400 100">
            <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
          </svg>
        )}
      </SettingsRow>
      <SettingsRow
        title="Project roots"
        description="One absolute path or ~/path per line. Scanned to depth seven."
        control={
          <Textarea
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
            variant="outline"
            disabled={!allowed || busy || !candidates.some((item) => selected.includes(item.id))}
            onClick={() =>
              setConfirming({
                phase: "B",
                reportId: report!.id,
                items: candidates.filter((item) => selected.includes(item.id)),
              })
            }
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
                variant="outline"
                disabled={!allowed || busy}
                onClick={() => setConfirming({ phase: "C", reportId: report!.id, items: [item] })}
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
          {protectedItems.map((item) => (
            <p key={item.id}>
              {item.path}
              {item.branch ? ` · ${item.branch}` : ""}
              {item.changes ? ` · ${item.changes} changes` : ""} · {item.reason}
            </p>
          ))}
        </SettingsRow>
      )}
      {[...new Set(report?.notes ?? [])].map((note) => (
        <p key={note}>{note}</p>
      ))}
      {report && (
        <SettingsRow
          title="Report JSON"
          description="Includes exact paths, measurements, outcomes and operational notes."
        >
          <details>
            <summary>View JSON</summary>
            <div className="max-h-80 overflow-auto">
              <pre>{JSON.stringify(report, null, 2)}</pre>
            </div>
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
          {confirming?.items.map((item) => (
            <p key={item.id}>
              {item.path} · {formatBytes(item.bytes)} · {item.effect}
            </p>
          ))}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
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
