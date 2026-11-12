import { AuthSettingsWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useServerConfigs } from "../state/entities";
import { readEnvironment } from "../state/environments";
import { useEnvironmentsWithScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { serverEnvironment } from "../state/server";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { toastManager } from "../components/ui/toast";

export function useProjectSidebarColor() {
  const configs = useServerConfigs();
  const allowed = useEnvironmentsWithScope(
    [...configs.keys()].map((environmentId) => ({ environmentId })),
    AuthSettingsWriteScope,
  );
  const save = useAtomCommand(serverEnvironment.updateSettings);
  type Member = { environmentId: EnvironmentId; id: ProjectId };
  const canSet = (members: readonly Member[]) =>
    members.every(
      (member) =>
        allowed.has(member.environmentId) &&
        readEnvironment(member.environmentId)?.connection.phase === "connected",
    );
  const setColor = async (members: readonly Member[], color: string | null) => {
    if (!canSet(members)) {
      toastManager.add({
        type: "warning",
        title:
          "Connect the project environments with settings permission to change its sidebar colour.",
      });
      return;
    }
    for (const member of members) {
      const settings = appAtomRegistry.get(
        serverEnvironment.settingsValueAtom(member.environmentId),
      );
      if (!settings) continue;
      await save({
        environmentId: member.environmentId,
        input: {
          patch: {
            projectSettingsOverrides: {
              [member.id]: { ...settings.projectSettingsOverrides[member.id], sidebarColor: color },
            },
          },
        },
      });
    }
  };
  return {
    canSet,
    setColor,
    colorFor: (member: Member) =>
      configs.get(member.environmentId)?.settings.projectSettingsOverrides[member.id]
        ?.sidebarColor ?? null,
  };
}
