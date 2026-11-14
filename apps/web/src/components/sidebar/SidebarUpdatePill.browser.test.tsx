import {
  type DesktopUpdateState,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render, stubGlobal } from "../../../test/render";
import { SidebarUpdatePill } from "./SidebarUpdatePill";
import type { UpdateEverythingRow } from "./updateEverything.logic";

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    update: null as DesktopUpdateState | null,
    hasUpdates: false,
    environments: [] as Array<{
      environmentId: EnvironmentId;
      label: string;
      connection: { phase: "connected" | "disconnected" };
    }>,
    providers: new Map<EnvironmentId, ReadonlyArray<ServerProvider>>(),
    updates: [] as Array<{ environmentId: EnvironmentId; input: unknown }>,
    refresh: null as Promise<unknown> | null,
    rows: [] as ReadonlyArray<UpdateEverythingRow>,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
  };
});
vi.mock("../../state/desktopUpdate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/desktopUpdate")>()),
  useDesktopUpdateState: (await import("react")).useSyncExternalStore.bind(
    null,
    mocks.subscribe,
    () => mocks.update,
  ),
}));
// The pill only renders in the desktop app.
vi.mock("../../env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../env")>()),
  isElectron: true,
}));
vi.mock("~/state/environments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/state/environments")>()),
  useEnvironments: () => ({ environments: mocks.environments }),
  useEnvironmentProviders: () => mocks.providers,
}));
vi.mock("~/state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/state/session")>()),
  useEnvironmentsWithScope: () => new Set(mocks.environments.map((e) => e.environmentId)),
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand:
    (command: { label: string }) =>
    async (request: { environmentId: EnvironmentId; input: unknown }) => {
      if (command.label === "environment-data:server:update-provider") {
        mocks.updates.push(request);
      }
      if (command.label === "environment-data:server:refresh-providers") {
        await mocks.refresh;
      }
      return AsyncResult.success(undefined);
    },
}));
vi.mock("./useUpdateEverything", () => ({
  useUpdateEverything: () => ({
    hasUpdates: mocks.hasUpdates,
    summary: "Update everything",
    version: null,
    providerCount: 0,
    rows: mocks.rows,
    restarts: [],
  }),
}));

function nightlyUpdate(releaseNotes: DesktopUpdateState["releaseNotes"]): DesktopUpdateState {
  return {
    enabled: true,
    status: "available",
    channel: "nightly",
    currentVersion: "0.0.50-nightly.1",
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    availableVersion: "0.0.50-nightly.2",
    downloadedVersion: null,
    releaseNotes,
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

const RELEASE_NOTES: DesktopUpdateState["releaseNotes"] = [
  { version: "0.0.50-nightly.2", items: ["Faster sidebar."], totalItems: 1 },
];

function setup(
  update: DesktopUpdateState | null,
  {
    hasUpdates = false,
    machines = [],
    rows = [],
  }: {
    hasUpdates?: boolean;
    machines?: Array<{ label: string; connected?: boolean; providers: ServerProvider[] }>;
    rows?: ReadonlyArray<UpdateEverythingRow>;
  } = {},
) {
  mocks.update = update;
  mocks.hasUpdates = hasUpdates;
  mocks.rows = rows;
  mocks.environments = machines.map(({ label, connected = true }) => ({
    environmentId: EnvironmentId.make(label),
    label,
    connection: { phase: connected ? "connected" : "disconnected" },
  }));
  mocks.providers = new Map(
    machines.map(({ label, providers }) => [EnvironmentId.make(label), providers]),
  );
  mocks.updates = [];
  mocks.refresh = null;
}

const CHECKED_AT = "2026-11-12T00:00:00.000Z";

function provider(
  driver: string,
  { latest, canUpdate = true }: { latest?: string; canUpdate?: boolean } = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: CHECKED_AT,
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: latest ? "behind_latest" : "current",
      currentVersion: "1.0.0",
      latestVersion: latest ?? "1.0.0",
      updateCommand: canUpdate ? `npm i -g ${driver}` : null,
      canUpdate,
      checkedAt: CHECKED_AT,
      message: canUpdate ? null : "Update it with the app or tool that installed it.",
    },
  };
}

function publish(update: DesktopUpdateState | null) {
  return act(() => {
    mocks.update = update;
    mocks.notify();
  });
}

const releaseNotes = () => document.querySelector('[aria-label="Update release notes"]');

describe("SidebarUpdatePill release notes", () => {
  it("closes when the release notes stop applying", async () => {
    setup(nightlyUpdate(RELEASE_NOTES));
    await using _screen = await render(<SidebarUpdatePill />);
    await userEvent.tab();
    await vi.waitFor(() => expect(releaseNotes()).not.toBeNull());

    await publish(nightlyUpdate([]));
    await vi.waitFor(() => expect(releaseNotes()).toBeNull());
  });

  it("opens when release notes arrive while the trigger has keyboard focus", async () => {
    setup(nightlyUpdate([]));
    await using _screen = await render(<SidebarUpdatePill />);
    await userEvent.tab();
    expect(releaseNotes()).toBeNull();

    await publish(
      nightlyUpdate([
        {
          version: "0.0.50-nightly.2",
          items: ["**One-time tasks.** Pick a date."],
          totalItems: 1,
          stats: "3 changes from 2 contributors",
          footer: "Plus 2 more bug fixes.",
        },
      ]),
    );
    await expect.element(page.getByText("One-time tasks.", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Plus 2 more bug fixes.")).toBeVisible();
  });

  it("checks for updates from the up-to-date release notes only when a check is allowed", async () => {
    const upToDate = { ...nightlyUpdate(RELEASE_NOTES), status: "up-to-date" as const };
    setup({ ...upToDate, enabled: false });
    const checkForUpdate = vi.fn(async () => ({ checked: true, state: upToDate }));
    using _bridge = stubGlobal("desktopBridge", { checkForUpdate });
    await using _screen = await render(<SidebarUpdatePill />);
    await userEvent.tab();
    const check = page.getByRole("button", { name: "Check for Updates" });
    await expect.element(check).toBeDisabled();

    await publish(upToDate);
    await expect.element(check).toBeEnabled();
    await userEvent.click(check);
    expect(checkForUpdate).toHaveBeenCalledOnce();
  });
});

describe("SidebarUpdatePill provider updates", () => {
  const upToDate = { ...nightlyUpdate(RELEASE_NOTES), status: "up-to-date" as const };

  it("lists each machine's provider updates and updates one candidate at a time", async () => {
    setup(upToDate, {
      machines: [
        {
          label: "Laptop",
          providers: [
            provider("codex", { latest: "1.1.0" }),
            provider("claudeAgent", { latest: "2.0.0", canUpdate: false }),
          ],
        },
        { label: "Server", providers: [provider("codex", { latest: "1.2.0" })] },
        { label: "Offline", connected: false, providers: [] },
      ],
    });
    await using _screen = await render(<SidebarUpdatePill />);
    await userEvent.tab();
    const section = page.getByRole("region", { name: "Provider updates" });
    await expect.element(section.getByText("v1.0.0 → v1.2.0")).toBeVisible();
    await expect.element(section.getByText("Update manually")).toBeVisible();
    await expect.element(section.getByText("1 machine not checked")).toBeVisible();
    // An unreached machine may still need updates.
    expect(section.element().textContent).not.toContain("up to date");

    await userEvent.click(section.getByRole("button", { name: "Update Codex on Server" }));
    expect(mocks.updates).toEqual([
      {
        environmentId: EnvironmentId.make("Server"),
        input: { provider: "codex", instanceId: "codex" },
      },
    ]);
  });

  it("keeps the check running until the provider check settles", async () => {
    setup(upToDate, { machines: [{ label: "Laptop", providers: [provider("codex")] }] });
    let finishRefresh!: () => void;
    const checkForUpdate = vi.fn(async () => ({ checked: true, state: upToDate }));
    using _bridge = stubGlobal("desktopBridge", { checkForUpdate });
    await using _screen = await render(<SidebarUpdatePill />);
    await userEvent.tab();
    await expect.element(page.getByText("Providers are up to date")).toBeVisible();

    mocks.refresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    await userEvent.click(page.getByRole("button", { name: "Check for Updates" }));
    expect(checkForUpdate).toHaveBeenCalledOnce();
    await expect.element(page.getByRole("button", { name: "Checking…" })).toBeDisabled();
    await expect.element(page.getByText("Checking providers…")).toBeVisible();

    await act(() => finishRefresh());
    await expect.element(page.getByRole("button", { name: "Check for Updates" })).toBeEnabled();
    await expect.element(page.getByText("Providers are up to date")).toBeVisible();
  });
});

describe("SidebarUpdatePill update everything", () => {
  it("does not refocus the update button after a pointer cancel", async () => {
    setup(null, { hasUpdates: true });
    await using screen = await render(<SidebarUpdatePill />);
    const button = screen.getByRole("button", { name: "Update everything" });
    await userEvent.click(button);
    const cancel = page.getByRole("button", { name: "Cancel" });
    await expect.element(cancel).toBeVisible();

    await userEvent.click(cancel);
    await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
    expect(document.activeElement).not.toBe(button.element());
  });

  it("returns focus to the update button after Escape", async () => {
    setup(null, { hasUpdates: true });
    await using screen = await render(<SidebarUpdatePill />);
    const button = screen.getByRole("button", { name: "Update everything" });
    await userEvent.click(button);
    await expect.element(page.getByRole("button", { name: "Cancel" })).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.activeElement).toBe(button.element()));
  });

  it("exposes the machines as a table with each value in its column", async () => {
    const label = "DESKTOP-WORKSTATION-UPSTAIRS";
    setup(null, {
      hasUpdates: true,
      rows: [{ environmentId: null, label, app: "this-app", skipped: null, providers: ["Claude"] }],
    });
    await using screen = await render(<SidebarUpdatePill />);
    await userEvent.click(screen.getByRole("button", { name: "Update everything" }));

    const table = page.getByRole("table");
    await expect.element(table.getByRole("columnheader", { name: "Machine" })).toBeVisible();
    await expect.element(table.getByRole("columnheader", { name: "T3 Code" })).toBeVisible();
    await expect.element(table.getByRole("columnheader", { name: "Providers" })).toBeVisible();
    const row = table.getByRole("row", { name: new RegExp(label) });
    await expect.element(row.getByRole("cell", { name: label, exact: true })).toBeVisible();
    await expect.element(row.getByRole("cell", { name: "Claude", exact: true })).toBeVisible();
  });
});
