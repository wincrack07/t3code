import { ForkSettingsGate } from "../components/settings/fork/ForkSettingsGate";
import { createFileRoute } from "@tanstack/react-router";

import { ForkMachineSettings } from "../components/settings/fork/ForkMachineSettings";

export const Route = createFileRoute("/_chat/settings/fork/machine")({
  component: () => (
    <ForkSettingsGate path="/settings/fork/machine">
      <ForkMachineSettings />
    </ForkSettingsGate>
  ),
});
