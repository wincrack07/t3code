import { createFileRoute } from "@tanstack/react-router";

import { PrReviewsSettings } from "../components/settings/PrReviewsSettings";

export const Route = createFileRoute("/_chat/settings/pr-reviews")({
  component: PrReviewsSettings,
});
