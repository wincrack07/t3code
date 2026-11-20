import { createFileRoute } from "@tanstack/react-router";

import { ForkFeaturesSettings } from "../components/settings/fork/ForkFeaturesSettings";

export const Route = createFileRoute("/_chat/settings/fork/features")({
  component: ForkFeaturesSettings,
});
