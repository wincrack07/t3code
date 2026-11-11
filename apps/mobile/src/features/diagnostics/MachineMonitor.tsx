import { useIsFocused } from "@react-navigation/native";
import { useState } from "react";
import { Pressable } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import { SettingsSection } from "../settings/components/SettingsSection";

const rate = (n: number | null) => (n === null ? "Unavailable" : `${(n / 1024).toFixed(0)} KB/s`);
const gb = (n: number | null) => (n === null ? "N/A" : `${(n / 1024 ** 3).toFixed(1)} GB`);
export function MachineMonitor() {
  const { environments } = useEnvironments();
  const focused = useIsFocused();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environment = environments.find((e) => e.environmentId === selected) ?? environments[0];
  const id = environment?.environmentId ?? null;
  const allowed = useEnvironmentScope(id, AuthOrchestrationReadScope);
  const { data, error } = useEnvironmentQuery(
    id && allowed && focused
      ? serverEnvironment.machineMonitor({ environmentId: id, input: {} })
      : null,
  );
  const s = data?.sample;
  return (
    <SettingsSection title="System monitor">
      {environments.length > 1
        ? environments.map((e) => (
            <Pressable
              key={e.environmentId}
              accessibilityRole="button"
              onPress={() => setSelected(e.environmentId)}
            >
              <Text>{e.label}</Text>
            </Pressable>
          ))
        : null}
      <Text>{environment?.label ?? "No environment connected"}</Text>
      {s ? (
        <>
          <Text>
            CPU {s.cpu?.toFixed(1) ?? "N/A"}% · RAM {gb(s.memoryUsed)} / {gb(s.memoryTotal)}
          </Text>
          <Text>
            Available {gb(s.memoryAvailable)} · Pressure {s.pressure}
          </Text>
          <Text>
            Swap {gb(s.swapUsed)} / {gb(s.swapTotal)}
          </Text>
          <Text>
            Storage free {gb(s.diskFree)} / {gb(s.diskTotal)}
          </Text>
          <Text>
            ↓ {rate(s.networkDown)} · ↑ {rate(s.networkUp)}
          </Text>
          <Text>
            Load {s.load.map((n) => n.toFixed(2)).join(" / ")} · Uptime{" "}
            {(s.uptime / 3600).toFixed(1)} hours
          </Text>
        </>
      ) : (
        <Text>{error ?? "Waiting for sample…"}</Text>
      )}
    </SettingsSection>
  );
}
