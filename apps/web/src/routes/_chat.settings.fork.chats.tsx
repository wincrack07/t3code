import { createFileRoute } from "@tanstack/react-router";

import { ForkChatsSettings } from "../components/settings/fork/ForkChatsSettings";

export const Route = createFileRoute("/_chat/settings/fork/chats")({
  component: ForkChatsSettings,
});
