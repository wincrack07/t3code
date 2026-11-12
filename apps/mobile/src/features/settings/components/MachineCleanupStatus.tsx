import { useAtomValue } from "@effect/atom-react";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import type { SettingsTarget } from "../settings-environment-filter";
import { ListActionRow } from "../../../components/ui/ListActionRow";
import { SettingsSection } from "./SettingsSection";
import { SettingsRow } from "./SettingsRow";

export function MachineCleanupStatus({ target }: { readonly target: SettingsTarget }) {
  const environmentId = target.environmentId;
  const query = useAtomValue(serverEnvironment.machineCleanupState({ environmentId, input: {} }));
  const allowed = useAtomValue(
    serverEnvironment.runMachineCleanupPhaseA.permissionAtom(environmentId),
  );
  const run = useAtomCommand(serverEnvironment.runMachineCleanupPhaseA);
  const scan = useAtomCommand(serverEnvironment.scanMachineCleanup);
  const state = query._tag === "Success" ? query.value : null;
  const report = state?.report;
  const pending =
    report?.items.filter((item) => item.phase === "B" && item.outcome === "pending") ?? [];
  return (
    <SettingsSection
      title={`Machine cleanup · ${target.label}`}
      footer="Review and confirm approval or aggressive items in the web or desktop maintenance settings. Mobile never approves those deletions."
    >
      <SettingsRow
        icon="internaldrive"
        label="Free space"
        value={
          state?.freeNow !== undefined
            ? `${(state.freeNow / 1024 ** 3).toFixed(1)} GiB`
            : report
              ? `${(report.freeAfter / 1024 ** 3).toFixed(1)} GiB`
              : "Not measured"
        }
      />
      <SettingsRow
        icon="clock"
        label="Last report"
        value={`${report?.finishedAt ?? state?.progress ?? "No report yet"}${pending.length ? ` · ${pending.length} await review` : ""}`}
        valuePosition="below"
      />
      <ListActionRow
        icon="magnifyingglass"
        label="Scan machine cleanup"
        disabled={!allowed || state?.running === true}
        onPress={() => void scan({ environmentId, input: {} })}
      />
      <ListActionRow
        icon="trash"
        label="Clean regenerable files now"
        disabled={!allowed || state?.running === true}
        onPress={() => void run({ environmentId, input: {} })}
      />
    </SettingsSection>
  );
}
