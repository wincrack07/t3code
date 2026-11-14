import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/pr-reviews")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/fork/pr-reviews", search: true, hash: true, replace: true });
  },
});
