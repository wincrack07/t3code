import { useAtomValue } from "@effect/atom-react";
import { useGT } from "gt-react-native";
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
  const gt = useGT();
  const run = useAtomCommand(serverEnvironment.runMachineCleanupPhaseA);
  const scan = useAtomCommand(serverEnvironment.scanMachineCleanup);
  const state = query._tag === "Success" ? query.value : null;
  const report = state?.report;
  const pending =
    report?.items.filter((item) => item.phase === "B" && item.outcome === "pending") ?? [];
  return (
    <SettingsSection
      title={gt("Machine cleanup · {label}", { label: target.label })}
      footer={gt(
        "Review and confirm approval or aggressive items in the web or desktop maintenance settings. Mobile never approves those deletions.",
      )}
    >
      <SettingsRow
        icon="internaldrive"
        label={gt("Free space")}
        value={
          state?.freeNow !== undefined
            ? `${(state.freeNow / 1024 ** 3).toFixed(1)} GiB`
            : report
              ? `${(report.freeAfter / 1024 ** 3).toFixed(1)} GiB`
              : gt("Not measured")
        }
      />
      <SettingsRow
        icon="clock"
        label={gt("Last report")}
        value={`${report?.finishedAt ?? state?.progress ?? gt("No report yet")}${pending.length ? ` · ${gt("{count} await review", { count: pending.length })}` : ""}`}
        valuePosition="below"
      />
      <ListActionRow
        icon="magnifyingglass"
        label={gt("Scan machine cleanup")}
        disabled={!allowed || state?.running === true}
        onPress={() => void scan({ environmentId, input: {} })}
      />
      <ListActionRow
        icon="trash"
        label={gt("Clean regenerable files now")}
        disabled={!allowed || state?.running === true}
        onPress={() => void run({ environmentId, input: {} })}
      />
    </SettingsSection>
  );
}
