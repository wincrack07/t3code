import { createFileRoute } from "@tanstack/react-router";

import { ForkComposerSettings } from "../components/settings/fork/ForkComposerSettings";

export const Route = createFileRoute("/_chat/settings/fork/composer")({
  component: ForkComposerSettings,
});
