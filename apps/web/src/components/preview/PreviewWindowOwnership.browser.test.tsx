import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { render, stubGlobal } from "../../../test/render";
import { PreviewView } from "./PreviewView";

it("shows a takeover action when another desktop window owns the browser", async () => {
  const key = "t3code:preview-owner:environment:thread";
  localStorage.setItem(key, "first");
  using _stored = { [Symbol.dispose]: () => localStorage.removeItem(key) };
  using _bridge = stubGlobal("desktopBridge", { windowId: "second" });
  await using screen = await render(
    <PreviewView
      threadRef={{
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make("thread"),
      }}
      visible
    />,
  );
  await expect.element(screen.getByText("Browser is open in another window.")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Show here" })).toBeVisible();
});
