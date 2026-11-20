import { ForkFeatureRoute } from "../components/ForkFeatureRoute";
import { createFileRoute } from "@tanstack/react-router";

import { ArtifactsPage } from "../components/artifacts/ArtifactsPage";

export const Route = createFileRoute("/_chat/artifacts")({
  component: () => (
    <ForkFeatureRoute feature="claudeArtifacts">
      <ArtifactsPage />
    </ForkFeatureRoute>
  ),
});
