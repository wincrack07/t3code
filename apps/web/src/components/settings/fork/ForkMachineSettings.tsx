import type { EnvironmentId } from "@t3tools/contracts";

import { useKeepAwake } from "../../KeepAwakeControl";
import { KeepAwakeSettingsFields, KeepAwakeTrayStatsFields } from "../KeepAwakeSettingsFields";
import { MachineCleanupSettings } from "../MachineCleanupSettings";
import { useSettingsScope } from "../SettingsScopeContext";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSearchTarget,
  SettingsSection,
} from "../settingsLayout";
import { searchableSetting } from "../settingsSearch";

export function ForkMachineSettings() {
  const { environment } = useSettingsScope();
  return (
    <SettingsPageContainer>
      {environment ? (
        <KeepAwakeSections environmentId={environment.environmentId} />
      ) : (
        <SettingsSection {...searchableSetting("keep-awake")}>
          <SettingsRow
            title="Choose one environment"
            description="Keep awake defaults belong to a single machine. Choose one above."
          />
        </SettingsSection>
      )}
      <SettingsSearchTarget {...searchableSetting("machine-cleanup")} className="flex flex-col gap-8">
        <MachineCleanupSettings />
      </SettingsSearchTarget>
    </SettingsPageContainer>
  );
}

function KeepAwakeSections({ environmentId }: { environmentId: EnvironmentId }) {
  const { status, error, disabled, send, authorize, localDesktop } = useKeepAwake(environmentId);
  return (
    <>
      <SettingsSection {...searchableSetting("keep-awake")}>
        {!status ? (
          <SettingsRow title={error ? "Keep awake is unavailable" : "Connecting…"} description={error} />
        ) : !status.supported ? (
          <SettingsRow
            title="Not supported"
            description="This machine can't be kept awake from T3 Code."
          />
        ) : (
          <KeepAwakeSettingsFields
            status={status}
            disabled={disabled}
            send={send}
            authorize={authorize}
            localDesktop={localDesktop}
          />
        )}
      </SettingsSection>
      {status?.supported ? (
        <SettingsSection {...searchableSetting("menu-bar-stats")}>
          <KeepAwakeTrayStatsFields status={status} disabled={disabled} send={send} />
        </SettingsSection>
      ) : null}
    </>
  );
}
