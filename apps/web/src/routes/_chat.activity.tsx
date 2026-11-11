import { createFileRoute } from "@tanstack/react-router";

import { ActivityBoardPage } from "../components/activityBoard/ActivityBoardPage";

export const Route = createFileRoute("/_chat/activity")({
  component: ActivityBoardPage,
});
