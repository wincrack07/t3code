import {
  EnvironmentId,
  ThreadId,
  type PreviewOpenInput,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { page, userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "../previewStateStore";

const state = vi.hoisted(() => ({
  openPreview: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock(import("../state/use-atom-command"), async (original) => {
  const { previewEnvironment } = await import("../state/preview");
  const actual = await original();
  return {
    ...actual,
    useAtomCommand: ((command: unknown, options: never) =>
      command === previewEnvironment.open
        ? state.openPreview
        : actual.useAtomCommand(command as never, options)) as never,
  };
});
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock(import("../browser/previewRuntime"), async (original) => ({
  ...(await original()),
  isPreviewAvailableFor: () => true,
}));
vi.mock(import("../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: () => ({ shell: { openExternal: state.openExternal } }) as never,
}));

import ChatMarkdown from "./ChatMarkdown";

const threadRef = {
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("thread-artifacts"),
};
const ARTIFACT = "https://claude.ai/code/artifact/0f8b6c2e-1d2a-4c3b-9e4f-5a6b7c8d9e0f";

function setup() {
  resetPreviewStateForTests();
  state.openExternal.mockReset().mockResolvedValue(undefined);
  state.openPreview
    .mockReset()
    .mockImplementation(async ({ input }: { input: PreviewOpenInput }) => {
      const snapshot: PreviewSessionSnapshot = {
        threadId: threadRef.threadId,
        tabId: `tab-${state.openPreview.mock.calls.length}`,
        navStatus: { _tag: "Loading", url: input.url ?? "", title: "" },
        canGoBack: false,
        canGoForward: false,
        updatedAt: "2026-11-11T00:00:00.000Z",
      };
      applyPreviewServerSnapshot(threadRef, snapshot);
      return AsyncResult.success(snapshot);
    });
}

it("opens an artifact link in the built-in browser and refocuses that tab on a second click", async () => {
  setup();
  await using _screen = await render(
    <ChatMarkdown
      cwd="/work"
      threadRef={threadRef}
      text={`See [the dashboard](${ARTIFACT}) and [docs](https://example.com/).`}
    />,
  );
  const link = page.getByRole("link", { name: /the dashboard/ });

  await userEvent.click(link);
  await vi.waitFor(() => expect(state.openPreview).toHaveBeenCalledTimes(1));
  expect(state.openPreview.mock.lastCall![0].input).toMatchObject({
    threadId: threadRef.threadId,
    url: ARTIFACT,
  });

  await userEvent.click(link);
  await vi.waitFor(() => expect(readThreadPreviewState(threadRef).activeTabId).toBe("tab-1"));
  expect(state.openPreview).toHaveBeenCalledTimes(1);
  expect(Object.keys(readThreadPreviewState(threadRef).sessions)).toEqual(["tab-1"]);
  expect(state.openExternal).not.toHaveBeenCalled();
});
