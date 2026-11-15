import { createFileRoute } from "@tanstack/react-router";

import { McpCatalogSettings } from "../components/settings/McpCatalogSettings";

export const Route = createFileRoute("/_chat/settings/fork/mcp")({
  component: McpCatalogSettings,
});
