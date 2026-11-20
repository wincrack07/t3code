import { ForkSettingsGate } from "../components/settings/fork/ForkSettingsGate";
import { createFileRoute } from "@tanstack/react-router";

import { McpCatalogSettings } from "../components/settings/McpCatalogSettings";

export const Route = createFileRoute("/_chat/settings/fork/mcp")({
  component: () => (
    <ForkSettingsGate path="/settings/fork/mcp">
      <McpCatalogSettings />
    </ForkSettingsGate>
  ),
});
