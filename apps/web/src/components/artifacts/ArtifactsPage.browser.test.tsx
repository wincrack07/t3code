import type {
  EnvironmentId,
  ProviderInstanceId,
  ClaudeArtifact,
  PreviewOpenInput,
  PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { page, userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";

import { render } from "../../../test/render";
import { __setClientSettingsForTests } from "../../hooks/useSettings";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { useArtifactRecentsStore } from "../../artifacts/artifactRecentsStore";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "../../previewStateStore";

const { local, instanceId, ARTIFACTS } = vi.hoisted(() => {
  const local = "local" as EnvironmentId;
  const instanceId = "claude" as ProviderInstanceId;
  const ARTIFACTS: ClaudeArtifact[] = [
    {
      id: "0f8b6c2e-1d2a-4c3b-9e4f-5a6b7c8d9e0f",
      url: "https://claude.ai/code/artifact/0f8b6c2e-1d2a-4c3b-9e4f-5a6b7c8d9e0f",
      title: "Sales dashboard",
      description: "Quarterly numbers",
      relation: "mine",
      isPublic: false,
      updatedAt: "2026-11-10T00:00:00Z",
    },
    {
      id: "1f8b6c2e-1d2a-4c3b-9e4f-5a6b7c8d9e0f",
      url: "https://claude.ai/code/artifact/1f8b6c2e-1d2a-4c3b-9e4f-5a6b7c8d9e0f",
      title: "Roadmap",
      relation: "shared",
      ownerEmail: "teammate@example.com",
      isPublic: true,
      updatedAt: "2026-11-09T00:00:00Z",
    },
  ];

  return { local, instanceId, ARTIFACTS };
});

const state = vi.hoisted(() => ({ openPreview: vi.fn(), closePreview: vi.fn() }));

vi.mock(import("../../env"), async (original) => ({ ...(await original()), isElectron: true }));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentProviders: (() =>
    new Map([
      [
        local,
        [
          {
            driver: "claudeAgent",
            enabled: true,
            instanceId,
            displayName: "Claude",
            auth: { email: "me@example.com" },
          },
        ],
      ],
    ])) as never,
  useConnectedEnvironmentIds: (() => [local]) as never,
  usePrimaryEnvironmentId: () => local,
  useEnvironments: (() => ({ presentationById: new Map() })) as never,
}));
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const accounts = Atom.make(
    AsyncResult.success({
      accounts: [{ instanceId, accountKey: "key", email: "me@example.com", listable: true }],
    }),
  );
  const listing = Atom.make(AsyncResult.success({ artifacts: ARTIFACTS, truncated: false }));
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      claudeArtifactAccounts: (() => accounts) as never,
      claudeArtifacts: (() => listing) as never,
    },
  };
});
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => {
  const { previewEnvironment } = await import("../../state/preview");
  const actual = await original();
  return {
    ...actual,
    useAtomCommand: ((command: unknown, options: never) =>
      command === previewEnvironment.open
        ? state.openPreview
        : command === previewEnvironment.close
          ? state.closePreview
          : actual.useAtomCommand(command as never, options)) as never,
  };
});
vi.mock(import("../preview/PreviewPanel"), () => ({
  PreviewPanel: (props: { tabId?: string | null }) => (
    <div data-testid="embedded-browser">{props.tabId}</div>
  ),
}));

import { ArtifactsPage } from "./ArtifactsPage";

function setup() {
  // Electron is faked, so settings would wait for a desktop bridge that is not there.
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  resetPreviewStateForTests();
  useArtifactRecentsStore.setState({ recents: [] });
  state.closePreview.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.openPreview
    .mockReset()
    .mockImplementation(
      async ({
        environmentId,
        input,
      }: {
        environmentId: EnvironmentId;
        input: PreviewOpenInput;
      }) => {
        const snapshot: PreviewSessionSnapshot = {
          threadId: input.threadId,
          tabId: `tab-${state.openPreview.mock.calls.length}`,
          navStatus: { _tag: "Loading", url: input.url ?? "", title: "" },
          canGoBack: false,
          canGoForward: false,
          updatedAt: "2026-11-11T00:00:00.000Z",
        };
        applyPreviewServerSnapshot({ environmentId, threadId: input.threadId }, snapshot);
        return AsyncResult.success(snapshot);
      },
    );
}

it("views an artifact beside the list and refocuses its tab when picked again", async () => {
  setup();
  await using _screen = await render(
    <AppAtomRegistryProvider>
      <ArtifactsPage />
    </AppAtomRegistryProvider>,
  );
  const list = page.getByRole("region", { name: "Artifacts", exact: true });
  const dashboard = list.getByRole("link", { name: /Sales dashboard/ });
  const roadmap = list.getByRole("link", { name: /Roadmap/ });

  await userEvent.click(dashboard);
  await expect.element(page.getByTestId("embedded-browser")).toHaveTextContent("tab-1");
  const [{ input }] = state.openPreview.mock.lastCall!;
  expect(input.url).toBe(ARTIFACTS[0]!.url);
  const viewerRef = { environmentId: local, threadId: input.threadId };
  await vi.waitFor(() =>
    expect(page.getByRole("region", { name: "Artifact viewer" }).element().textContent).toMatch(
      /Sales dashboard/,
    ),
  );

  await userEvent.click(roadmap);
  await expect.element(page.getByTestId("embedded-browser")).toHaveTextContent("tab-2");
  await userEvent.click(page.getByRole("button", { name: "Previous artifact" }));
  await expect.element(page.getByTestId("embedded-browser")).toHaveTextContent("tab-1");
  await userEvent.click(dashboard);

  expect(state.openPreview).toHaveBeenCalledTimes(2);
  expect(Object.keys(readThreadPreviewState(viewerRef).sessions).toSorted()).toEqual([
    "tab-1",
    "tab-2",
  ]);
  // Both were opened, so both lead the recents, newest first.
  await vi.waitFor(() =>
    expect(page.getByRole("region", { name: "Recent artifacts" }).element().textContent).toMatch(
      /Sales dashboard[\s\S]*Roadmap/,
    ),
  );
});

it("opens the sort select and a row's actions menu", async () => {
  setup();
  await using _screen = await render(
    <AppAtomRegistryProvider>
      <ArtifactsPage />
    </AppAtomRegistryProvider>,
  );

  await userEvent.click(page.getByRole("combobox", { name: "Sort artifacts" }));
  await userEvent.click(page.getByRole("option", { name: "Title" }));
  await vi.waitFor(() =>
    expect(
      page.getByRole("region", { name: "Artifacts", exact: true }).element().textContent,
    ).toMatch(/Roadmap[\s\S]*Sales dashboard/),
  );

  await userEvent.click(page.getByRole("button", { name: "Artifact actions" }).first());
  await expect
    .element(page.getByRole("menuitem", { name: "Open in default browser" }))
    .toBeVisible();
  await expect.element(page.getByRole("menuitem", { name: "Copy link" })).toBeVisible();
  await userEvent.click(page.getByRole("menuitem", { name: "View here" }));
  await expect.element(page.getByTestId("embedded-browser")).toHaveTextContent("tab-1");
});
