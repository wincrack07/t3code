import { useIsFocused } from "@react-navigation/native";
import {
  formatMachineBytes,
  formatMachinePercent,
  formatMachineRate,
  formatMachineUptime,
  presentMachineHealth,
  type MachineHealthLevel,
} from "@t3tools/client-runtime/state/machine-monitor";
import type { EnvironmentId } from "@t3tools/contracts";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import { SettingsSection } from "../settings/components/SettingsSection";

// Color appears only when a metric needs attention.
const BAR: Record<MachineHealthLevel, string> = {
  ok: "bg-foreground-muted",
  busy: "bg-amber-500",
  strained: "bg-red-500",
};
const DOT: Record<MachineHealthLevel | "unknown", string> = {
  ok: "bg-emerald-500",
  busy: "bg-amber-500",
  strained: "bg-red-500",
  unknown: "bg-subtle-strong",
};
const TABULAR = { fontVariant: ["tabular-nums" as const] };

export function MachineMonitor() {
  const gt = useGT();
  const messages = useMessages();
  const { environments } = useEnvironments();
  const focused = useIsFocused();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environment = environments.find((e) => e.environmentId === selected) ?? environments[0];
  const id = environment?.environmentId ?? null;
  const allowed = useEnvironmentScope(id, AuthOrchestrationReadScope);
  // Samples only, and only while this screen is focused.
  const { data, error } = useEnvironmentQuery(
    id && allowed && focused
      ? serverEnvironment.machineMonitor({ environmentId: id, input: {} })
      : null,
  );
  const sample = data?.sample ?? null;
  const health = sample ? presentMachineHealth(sample, messages) : null;
  const connected = environment?.connection.phase === "connected";
  const level = health && connected ? health.level : "unknown";
  const headline =
    environment === undefined
      ? gt("No environment connected")
      : !allowed
        ? gt("No access to this machine")
        : health === null
          ? error
            ? gt("Monitor unavailable")
            : gt("Reading machine")
          : connected
            ? health.headline
            : gt("Disconnected");
  const subline =
    sample === null
      ? (error ??
        (environment ? environment.label : gt("Connect an environment to see its machine")))
      : connected
        ? gt("{label} · up {uptime}", {
            label: environment!.label,
            uptime: formatMachineUptime(sample.uptime),
          })
        : gt("{label} · last sample {time}", {
            label: environment!.label,
            time: new Date(sample.at).toLocaleTimeString(),
          });

  return (
    <SettingsSection title={gt("Machine monitor")}>
      <View className="gap-4 p-4">
        {environments.length > 1 ? (
          <SegmentedControl
            size="compact"
            variant="card"
            options={environments.map((e) => ({ value: e.environmentId, label: e.label }))}
            selected={id ?? environments[0]!.environmentId}
            onSelect={setSelected}
          />
        ) : null}
        <View className="flex-row items-center gap-3">
          <View className={`size-2.5 rounded-full ${DOT[level]}`} />
          <View className="min-w-0 flex-1">
            <Text className="text-base font-t3-medium text-foreground">{headline}</Text>
            <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
              {subline}
            </Text>
          </View>
        </View>
        {sample && health ? (
          <View className="gap-3">
            <Meter
              label="CPU"
              share={health.cpu}
              level={health.cpuLevel}
              value={formatMachinePercent(health.cpu)}
              detail={gt("Load {load}", {
                load: sample.load.map((v) => v.toFixed(2)).join(" · "),
              })}
            />
            <Meter
              label={gt("Memory")}
              share={health.memory}
              level={health.memoryLevel}
              value={formatMachinePercent(health.memory)}
              detail={
                sample.swapUsed !== null && sample.swapTotal
                  ? gt("{used} of {total} · swap {swap}", {
                      used: formatMachineBytes(sample.memoryUsed),
                      total: formatMachineBytes(sample.memoryTotal),
                      swap: formatMachineBytes(sample.swapUsed),
                    })
                  : gt("{used} of {total}", {
                      used: formatMachineBytes(sample.memoryUsed),
                      total: formatMachineBytes(sample.memoryTotal),
                    })
              }
            />
            {sample.diskFree !== null && sample.diskTotal !== null ? (
              <Meter
                label={gt("Disk")}
                share={health.disk}
                level={health.diskLevel}
                value={formatMachinePercent(health.disk)}
                detail={gt("{free} free of {total}", {
                  free: formatMachineBytes(sample.diskFree),
                  total: formatMachineBytes(sample.diskTotal),
                })}
              />
            ) : null}
            <View className="flex-row items-baseline justify-between gap-3">
              <Text className="text-sm text-foreground-muted">
                <T>Network</T>
              </Text>
              <Text className="text-sm text-foreground" style={TABULAR}>
                {sample.networkDown === null || sample.networkUp === null
                  ? gt("Not reported yet")
                  : `↓ ${formatMachineRate(sample.networkDown)}   ↑ ${formatMachineRate(sample.networkUp)}`}
              </Text>
            </View>
            {data!.limitations.map((message) => (
              <Text key={message} textRole="footnote" className="text-foreground-muted">
                {message}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

function Meter(props: {
  label: string;
  share: number | null;
  level: MachineHealthLevel;
  value: string;
  detail: string;
}) {
  const percent = props.share === null ? 0 : Math.round(props.share * 100);
  return (
    <View className="gap-1.5">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-sm text-foreground-muted">{props.label}</Text>
        <Text className="text-sm font-t3-medium text-foreground" style={TABULAR}>
          {props.value}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={props.label}
        accessibilityValue={{ min: 0, max: 100, now: percent, text: props.detail }}
        className="h-1.5 overflow-hidden rounded-full bg-subtle"
      >
        <View
          className={`h-full rounded-full ${BAR[props.level]}`}
          style={{ width: `${percent}%` }}
        />
      </View>
      <Text textRole="footnote" className="text-foreground-muted" style={TABULAR} numberOfLines={1}>
        {props.detail}
      </Text>
    </View>
  );
}
