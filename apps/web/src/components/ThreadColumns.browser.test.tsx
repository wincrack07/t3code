import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { StrictMode, useState, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { useThreadColumnsStore } from "../threadColumnsStore";
import { ThreadColumns } from "./ThreadColumns";
import { ChatHeader } from "./chat/ChatHeader";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import type { ThreadRouteTarget } from "../threadRoutes";

const state = vi.hoisted(() => ({ navigate: vi.fn(async (_options?: unknown) => {}) }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => state.navigate,
}));
vi.mock("../state/entities", () => ({
  useQuietThreadShell: (ref: ScopedThreadRef) => ({ title: ref.threadId }),
}));
vi.mock("../hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("./ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./ThreadRouteView", () => ({
  ThreadRouteView: ({ target }: { target: ThreadRouteTarget }) =>
    target.kind === "draft" ? (
      <>
        <h1>What should we build?</h1>
        <textarea aria-label="Message" />
      </>
    ) : null,
}));
vi.mock("../hooks/useThreadActionMenu", () => ({
  useThreadActionMenu: () => ({ openMenu: () => {}, closeMenu: () => {} }),
}));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => async () => ({ _tag: "Success" }),
}));
vi.mock("./chat/GuestShareControls", () => ({ GuestShareIndicator: () => null }));
vi.mock("./ProjectFavicon", () => ({ ProjectFavicon: () => null }));
vi.mock("./chat/guestShareAvailability", async () => {
  const { Atom } = await import("effect/reactivity");
  const available = Atom.make(false);
  return { canShareWithGuestAtom: () => available };
});

const ref = (id: string) => ({
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make(id),
});
function setup() {
  state.navigate.mockClear();
  const previous = useThreadColumnsStore.getState();
  useThreadColumnsStore.setState({ columns: [], activeId: null });
  const store = useThreadColumnsStore.getState();
  store.navigate(ref("a"));
  store.open(ref("b"));
  return { [Symbol.dispose]: () => useThreadColumnsStore.setState(previous) };
}

it.each(["a", "c"])(
  "the loaded URL for %s wins over persisted active column b during effect replay",
  async (id) => {
    using _layout = setup();
    // Routing is observed through the navigation mock so an incorrect initial redirect cannot hide itself.
    await using screen = await render(
      <StrictMode>
        <ThreadColumns target={{ kind: "server", threadRef: ref(id) }} background={false} />
      </StrictMode>,
      { router: false },
    );
    await expect
      .element(screen.getByRole("region", { name: id }))
      .toHaveAttribute("data-active-thread-column", "true");
    expect(state.navigate).not.toHaveBeenCalled();
    expect(
      useThreadColumnsStore.getState().columns.map((column) => column.threadRef.threadId),
    ).toEqual(id === "a" ? ["a", "b"] : ["a", "c"]);
    const layout = useThreadColumnsStore.getState();
    const neighbor = layout.columns.find((column) => column.id !== layout.activeId)!;
    await act(() => useThreadColumnsStore.getState().activate(neighbor.id));
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: neighbor.threadRef,
    });
    await screen.rerender(
      <StrictMode>
        <ThreadColumns
          target={{ kind: "server", threadRef: neighbor.threadRef }}
          background={false}
        />
      </StrictMode>,
    );
    expect(state.navigate).toHaveBeenCalledTimes(1);
  },
);

it("keeps one project breadcrumb navigation when an automatic draft moves to another environment", async () => {
  using _layout = setup();
  const previousDrafts = useComposerDraftStore.getState();
  using _drafts = { [Symbol.dispose]: () => useComposerDraftStore.setState(previousDrafts) };
  const draftId = DraftId.make("breadcrumb-draft");
  const remote = EnvironmentId.make("remote");
  const projectId = ProjectId.make("project");
  useComposerDraftStore
    .getState()
    .setLogicalProjectDraftThreadId("project", { environmentId: remote, projectId }, draftId, {
      threadId: ThreadId.make("unsent"),
    });
  function ProjectThread() {
    const [target, setTarget] = useState<ThreadRouteTarget>({
      kind: "server",
      threadRef: { environmentId: remote, threadId: ThreadId.make("child") },
    });
    return (
      <>
        <ChatHeader
          activeThreadEnvironmentId={remote}
          activeThreadId={ThreadId.make("child")}
          activeThreadTitle="Child thread"
          isServerThread
          activeProject={{
            id: projectId,
            environmentId: remote,
            title: "Project",
            workspaceRoot: "/repo",
            repositoryIdentity: null,
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            pinnedAt: null,
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          }}
          parentThreadLink={{ threadId: ThreadId.make("parent"), title: "Parent thread" }}
          onOpenThread={() => {}}
          rightPanelOpen={false}
          onNewThreadInProject={() => {
            void state.navigate({ to: "/draft/$draftId", params: { draftId } });
            setTarget({ kind: "draft", draftId });
          }}
        />
        <ThreadColumns target={target} background={false} />
      </>
    );
  }
  await using screen = await render(<ProjectThread />);
  await screen.getByRole("button", { name: "New thread in Project", exact: true }).click();
  await expect.element(screen.getByRole("textbox", { name: "Message" })).toBeVisible();
  await act(() =>
    useComposerDraftStore.getState().setDraftThreadContext(draftId, {
      projectRef: { environmentId: EnvironmentId.make("local"), projectId },
      environmentSelection: "auto",
      loadBalancedEnvironmentId: EnvironmentId.make("local"),
    }),
  );
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
    to: "/draft/$draftId",
    params: { draftId },
  });
  await expect
    .element(screen.getByRole("heading", { name: "What should we build?" }))
    .toBeVisible();
  const layout = useThreadColumnsStore.getState();
  expect(
    layout.columns.find((column) => column.id === layout.activeId)?.threadRef.environmentId,
  ).toBe("local");
});
