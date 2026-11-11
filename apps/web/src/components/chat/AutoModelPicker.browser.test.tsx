import { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";

vi.mock("../../state/entities", async () => {
  const { DEFAULT_SERVER_SETTINGS, EnvironmentId } = await import("@t3tools/contracts");
  return {
    useServerConfigs: () =>
      new Map([
        [
          EnvironmentId.make("auto-test"),
          {
            settings: {
              ...DEFAULT_SERVER_SETTINGS,
              decisions: { ...DEFAULT_SERVER_SETTINGS.decisions, enabled: true },
            },
          },
        ],
      ]),
  };
});

it("selects Auto inside the composer picker and returns to a concrete model", async () => {
  const instanceId = ProviderInstanceId.make("codex");
  const entries = deriveProviderInstanceEntries([
    {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00Z",
      models: [{ slug: "fast", name: "Fast model", isCustom: false, capabilities: {} }],
      slashCommands: [],
      skills: [],
    },
  ]);
  function Picker() {
    const [model, setModel] = useState("fast");
    return (
      <ProviderModelPicker
        isComposerOwned
        environmentId={EnvironmentId.make("auto-test")}
        activeInstanceId={instanceId}
        model={model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={new Map([[instanceId, entries[0]!.models]])}
        onInstanceModelChange={(_instance, next) => setModel(next)}
      />
    );
  }
  await using screen = await render(<Picker />);
  await screen.getByRole("button", { name: "Fast model", exact: true }).click();
  await page.getByRole("option", { name: /Auto.*Choose provider/ }).click();
  await expect.element(screen.getByRole("button", { name: "Auto", exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Auto", exact: true }).click();
  await page.getByRole("option", { name: /Fast model/ }).click();
  await expect
    .element(screen.getByRole("button", { name: "Fast model", exact: true }))
    .toBeVisible();
});
