import { ForkFeatureRoute } from "../components/ForkFeatureRoute";
import { createFileRoute } from "@tanstack/react-router";
import { AllChatsPage } from "../components/chatHub/AllChatsPage";
export const Route = createFileRoute("/_chat/all-chats")({
  component: () => (
    <ForkFeatureRoute feature="chatHub">
      <AllChatsPage />
    </ForkFeatureRoute>
  ),
});
