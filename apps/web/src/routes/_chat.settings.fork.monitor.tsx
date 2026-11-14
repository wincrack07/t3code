import { createFileRoute } from "@tanstack/react-router";

import { SystemMonitorSettingsPanel } from "../components/systemMonitor/SystemMonitorPage";

export const Route = createFileRoute("/_chat/settings/fork/monitor")({
  component: SystemMonitorSettingsPanel,
});
