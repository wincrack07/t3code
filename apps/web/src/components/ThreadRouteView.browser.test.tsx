import { Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { ThreadRouteView } from "./ThreadRouteView";

const state = vi.hoisted(() => ({ missing: false, listeners: new Set<() => void>() }));
vi.mock("./ChatView", () => ({ default: () => <p>Conversation</p> }));
vi.mock("../state/entities", async () => {
  const { useSyncExternalStore } = await import("react");
  const shell = { deletedAt: null, archivedAt: null };
  return {
    useQuietThreadShell: () =>
      useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => {
            state.listeners.delete(listener);
          };
        },
        () => (state.missing ? null : shell),
      ),
    useEnvironmentThreadRefs: () => [],
    useAnyEnvironmentHiding: () => false,
  };
});
vi.mock("../state/shell", () => ({ useEnvironmentShellStatus: () => "live" }));
vi.mock("../state/environments", () => ({ useEnvironment: () => ({ label: "Remote" }) }));
vi.mock("../state/threads", () => ({
  threadFamilies: { mount: () => () => {} },
  environmentThreadShells: { hiddenThreadKeysAtom: Atom.make(new Set()) },
  useEnvironmentThread: () => ({ status: "deleted", data: Option.none() }),
}));
vi.mock("./ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

function RouteView() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return pathname === "/" ? (
    <main>
      <h1>What should we build?</h1>
      <textarea aria-label="Message" />
    </main>
  ) : (
    <ThreadRouteView
      target={{
        kind: "server",
        threadRef: { environmentId: EnvironmentId.make("remote"), threadId: ThreadId.make("last") },
      }}
    />
  );
}

it("leaves the last missing thread for the new-thread screen", async () => {
  state.missing = false;
  await using screen = await render(<RouteView />, { router: "/remote/last" });
  await expect.element(screen.getByText("Conversation")).toBeVisible();
  await act(() => {
    state.missing = true;
    for (const listener of state.listeners) listener();
  });
  await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/"));
  await expect
    .element(screen.getByRole("heading", { name: "What should we build?" }))
    .toBeVisible();
  await expect.element(screen.getByRole("textbox", { name: "Message" })).toBeVisible();
});
