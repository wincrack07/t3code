import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { StrictMode, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { useThreadColumnsStore } from "../threadColumnsStore";
import { ThreadColumns } from "./ThreadColumns";

const state = vi.hoisted(() => ({ navigate: vi.fn(async () => {}) }));
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
vi.mock("./ThreadRouteView", () => ({ ThreadRouteView: () => null }));

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
