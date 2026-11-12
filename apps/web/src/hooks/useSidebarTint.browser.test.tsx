import "../index.css";
import type * as Context from "effect/Context";
import { ThreadId, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";
import { useSidebarTint } from "./useSidebarTint";
import { useThreadRouteTarget } from "./useThreadRouteTarget";
import { useThreadColumnsStore } from "../threadColumnsStore";
import { __setClientSettingsForTests, getClientSettings } from "./useSettings";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});
vi.mock("./useThreadRouteTarget", { spy: true });
vi.mock("../state/entities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/entities")>();
  const { PROJECT_ID } = await import("../../test/fakeEnvironment");
  const { ProjectId } = await import("@t3tools/contracts");
  return {
    ...actual,
    useQuietThreadShell: (ref: Parameters<typeof actual.useQuietThreadShell>[0]) => {
      const thread = actual.useQuietThreadShell(ref);
      return thread && ref?.threadId === "second"
        ? { ...thread, projectId: ProjectId.make("second") }
        : thread;
    },
    useServerConfigs: () =>
      new Map(
        [...actual.useServerConfigs()].map(([id, config]) => [
          id,
          {
            ...config,
            settings: {
              ...config.settings,
              projectSettingsOverrides: {
                [PROJECT_ID]: { sidebarColor: "#629bd7" },
                second: { sidebarColor: "#df646c" },
              },
            },
          },
        ]),
      ),
  };
});

function Harness() {
  const style = useSidebarTint();
  return (
    <>
      <aside data-app-sidebar style={style}>
        Sidebar
      </aside>
      <main>Conversation</main>
    </>
  );
}

it("changes only sidebar tokens when focus moves between split columns", async () => {
  const first = threadWithHistory("first", 1);
  const second = threadWithHistory("second", 1);
  using _environment = installFakeEnvironment([first, second]);
  using stack = new DisposableStack();
  const oldSettings = getClientSettings();
  const oldColumns = useThreadColumnsStore.getState();
  const oldClass = document.documentElement.className;
  stack.defer(() => {
    __setClientSettingsForTests(oldSettings);
    useThreadColumnsStore.setState(oldColumns);
    document.documentElement.className = oldClass;
    vi.mocked(useThreadRouteTarget).mockRestore();
  });
  document.documentElement.classList.add("dark");
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  const a = { environmentId: ENVIRONMENT_ID, threadId: ThreadId.make("first") };
  const b = { environmentId: ENVIRONMENT_ID, threadId: ThreadId.make("second") };
  vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef: a });
  useThreadColumnsStore.setState({
    columns: [
      { id: "a", threadRef: a, width: 1 },
      { id: "b", threadRef: b, width: 1 },
    ],
    activeId: "a",
  });
  await using screen = await render(<Harness />);
  const sidebar = screen.container.querySelector("aside")!;
  await vi.waitFor(() => expect(sidebar.style.getPropertyValue("--sidebar")).toMatch(/^#/));
  const firstTint = sidebar.style.getPropertyValue("--sidebar");
  await act(() => useThreadColumnsStore.getState().activate("b"));
  await vi.waitFor(() => expect(sidebar.style.getPropertyValue("--sidebar")).not.toBe(firstTint));
  expect(screen.container.querySelector("main")!.style.getPropertyValue("--sidebar")).toBe("");
  expect(document.documentElement.style.getPropertyValue("--sidebar")).toBe("");
});
