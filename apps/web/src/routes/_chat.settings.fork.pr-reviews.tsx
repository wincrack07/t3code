import { ForkSettingsGate } from "../components/settings/fork/ForkSettingsGate";
import { createFileRoute } from "@tanstack/react-router";

import { PrReviewsSettings } from "../components/settings/PrReviewsSettings";

export const Route = createFileRoute("/_chat/settings/fork/pr-reviews")({
  component: () => (
    <ForkSettingsGate path="/settings/fork/pr-reviews">
      <PrReviewsSettings />
    </ForkSettingsGate>
  ),
});
