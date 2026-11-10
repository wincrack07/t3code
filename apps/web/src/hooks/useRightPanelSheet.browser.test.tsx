import { Profiler } from "react";
import { page } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { observeResize } from "../lib/observeResize";
import { useRightPanelSheet } from "./useRightPanelSheet";

function Presentation({ container }: { container: HTMLElement }) {
  const sheet = useRightPanelSheet(container);
  return <output aria-label="Panel presentation">{sheet ? "sheet" : "inline"}</output>;
}

it("uses the column's available width and updates only the presentation threshold", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height),
  };
  await page.viewport(1280, 800);
  const commits = vi.fn();
  const container = document.createElement("div");
  container.style.width = "512px";
  // This hook observes element geometry without navigating.
  await using screen = await render(
    <Profiler id="presentation" onRender={commits}>
      <Presentation container={container} />
    </Profiler>,
    {
      container,
      router: false,
    },
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent("sheet");
  const initialCommits = commits.mock.calls.length;
  await act(
    () =>
      new Promise<void>((resolve) => {
        const stop = observeResize(container, (entries) => {
          if (!entries.some((entry) => entry.contentRect.width === 600)) return;
          stop();
          resolve();
        });
        container.style.width = "600px";
      }),
  );
  expect(commits).toHaveBeenCalledTimes(initialCommits);
  await act(() => {
    container.style.width = "900px";
  });
  await expect.element(screen.getByRole("status")).toHaveTextContent("inline");
  await act(() => {
    container.style.width = "719px";
  });
  await expect.element(screen.getByRole("status")).toHaveTextContent("sheet");
  await act(() => {
    container.style.width = "720px";
  });
  await expect.element(screen.getByRole("status")).toHaveTextContent("inline");
});
