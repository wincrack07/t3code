import { createFileRoute } from "@tanstack/react-router";

import { PrReviewsSettings } from "../components/settings/PrReviewsSettings";

export const Route = createFileRoute("/_chat/settings/fork/pr-reviews")({
  component: PrReviewsSettings,
});
