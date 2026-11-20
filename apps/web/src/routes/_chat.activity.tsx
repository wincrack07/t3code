import { ForkFeatureRoute } from "../components/ForkFeatureRoute";
import { createFileRoute } from "@tanstack/react-router";

import { ActivityBoardPage } from "../components/activityBoard/ActivityBoardPage";

export const Route = createFileRoute("/_chat/activity")({
  component: () => (
    <ForkFeatureRoute feature="activityBoard">
      <ActivityBoardPage />
    </ForkFeatureRoute>
  ),
});
