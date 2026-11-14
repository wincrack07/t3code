import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/monitor")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/fork/monitor", search: true, hash: true, replace: true });
  },
});
