import { createFileRoute } from "@tanstack/react-router";

import { ForkConnectionsSettings } from "../components/settings/fork/ForkConnectionsSettings";

export const Route = createFileRoute("/_chat/settings/fork/connections")({
  component: ForkConnectionsSettings,
});
