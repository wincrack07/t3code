import "../../index.css";
import { render } from "../../../test/render";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type MachineCleanupState,
} from "@t3tools/contracts";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ value: null as MachineCleanupState | null, run: vi.fn() }));
vi.mock(import("../../state/server"), async () => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  const report = Atom.make(() => ({ _tag: "Success", waiting: false, value: state.value }));
  const command = (label: string) => ({ label, permissionAtom: () => allowed });
  return {
    serverEnvironment: {
      machineCleanupState: () => report,
      scanMachineCleanup: command("scan"),
      runMachineCleanupPhaseA: command("phaseA"),
      deleteMachineCleanupApproved: command("phaseB"),
      runMachineCleanupPhaseC: command("phaseC"),
      cancelMachineCleanup: command("cancel"),
      updateSettings: command("settings"),
    },
  } as never;
});
vi.mock(
  import("../../state/use-atom-command"),
  () =>
    ({
      useAtomCommand: ((command: { label: string }) => (value: unknown) =>
        state.run(command.label, value)) as never,
    }) as never,
);
vi.mock(
  import("./SettingsScopeContext"),
  () =>
    ({
      useSettingsScope: () => ({
        connectedEnvironments: [
          {
            environmentId: "fixture",
            label: "Fixture",
            serverConfig: {
              environment: { capabilities: { machineCleanup: true } },
              settings: DEFAULT_SERVER_SETTINGS,
            },
          },
        ],
      }),
    }) as never,
);
vi.mock(
  import("./settingsLayout"),
  () =>
    ({
      SettingsSection: ({ title, children }: { title: string; children: ReactNode }) => (
        <section aria-label={title}>{children}</section>
      ),
      SettingsRow: ({
        title,
        description,
        control,
        children,
      }: {
        title: string;
        description?: ReactNode;
        control?: ReactNode;
        children?: ReactNode;
      }) => (
        <div>
          <h3>{title}</h3>
          <div>{description}</div>
          {control}
          {children}
        </div>
      ),
    }) as never,
);
import { MachineCleanupSettings } from "./MachineCleanupSettings";

function setup() {
  state.run.mockReset();
  state.value = {
    running: false,
    progress: "Finished",
    history: [],
    report: {
      id: "report",
      mode: "scan",
      platform: "linux",
      startedAt: "2026-11-11T06:00:00Z",
      finishedAt: "2026-11-11T06:01:00Z",
      measurementPath: "/fixture",
      freeBefore: 12 * 1024 ** 3,
      freeAfter: 12 * 1024 ** 3,
      notes: [],
      items: [
        {
          id: "candidate",
          path: "/fixture/app/node_modules",
          project: "/fixture/app",
          rule: "node-modules",
          phase: "B",
          bytes: 1024 ** 3,
          effect: "Dependencies download again",
          probablyActive: false,
          outcome: "pending",
          reason: "",
          branch: null,
          changes: 0,
          head: null,
        },
      ],
    },
  };
}

it("opens machine cleanup and requires exact-path confirmation before submitting approval", async () => {
  setup();
  await using screen = await render(<MachineCleanupSettings />, {
    router: "/settings/maintenance",
  });
  await expect
    .element(screen.getByRole("region", { name: "Machine cleanup · Fixture" }))
    .toBeVisible();
  await screen.getByRole("checkbox", { name: "Select /fixture/app/node_modules" }).click();
  await screen.getByRole("button", { name: "Delete selected" }).click();
  await expect.element(screen.getByRole("alertdialog")).toBeVisible();
  await expect
    .element(
      screen.getByRole("alertdialog").getByText("/fixture/app/node_modules", { exact: false }),
    )
    .toBeVisible();
  expect(state.run).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Remove approved files" }).click();
  expect(state.run).toHaveBeenCalledWith("phaseB", {
    environmentId: EnvironmentId.make("fixture"),
    input: { reportId: "report", itemIds: ["candidate"] },
  });
});
