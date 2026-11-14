import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { DEFAULT_KEEP_AWAKE, type KeepAwakeStatus } from "@t3tools/contracts";
import type { ReactNode } from "react";
import "../index.css";
import { render } from "../../test/render";
import { KeepAwakeForm } from "./KeepAwakeControl";
import { KeepAwakeSettingsFields } from "./settings/KeepAwakeSettingsFields";
import { Button } from "./ui/button";
import { Popover, PopoverTrigger, PopoverPopup } from "./ui/popover";

vi.mock("./settings/settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    control,
    children,
  }: {
    title: ReactNode;
    description?: ReactNode;
    control?: ReactNode;
    children?: ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
      {control}
      {children}
    </section>
  ),
}));

function status(): KeepAwakeStatus {
  return {
    supported: true,
    active: false,
    mode: "off",
    agents: 0,
    endsAt: null,
    reason: null,
    lidClosedSupported: true,
    options: DEFAULT_KEEP_AWAKE.options,
    defaults: DEFAULT_KEEP_AWAKE,
    lid: {
      authorized: false,
      active: false,
      error: null,
      nativeAuthorization: true,
      installCommand: "install on Mac",
      removeCommand: "remove on Mac",
    },
  };
}

it("opens the popover and its end-time menus, showing only the selected mode's fields", async () => {
  const send = vi.fn();
  await using screen = await render(
    <Popover>
      <PopoverTrigger render={<Button />}>Keep awake</PopoverTrigger>
      <PopoverPopup width="md">
        <KeepAwakeForm
          status={status()}
          disabled={false}
          send={send}
          authorize={vi.fn()}
          localDesktop
        />
      </PopoverPopup>
    </Popover>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Keep awake" }));
  await expect.element(page.getByRole("status")).toHaveTextContent("Off");
  await expect.element(page.getByLabelText("Duration in minutes")).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("combobox", { name: "Session" }));
  await userEvent.click(page.getByRole("option", { name: "For a duration", exact: true }));
  await expect.element(page.getByLabelText("Duration in minutes")).toBeVisible();
  expect(send).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole("combobox", { name: "Session" }));
  await userEvent.click(page.getByRole("option", { name: "Until a time", exact: true }));
  await expect.element(page.getByLabelText("Duration in minutes")).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("combobox", { name: "End day" }));
  await userEvent.click(page.getByRole("option", { name: "Tomorrow", exact: true }));
  await userEvent.click(page.getByRole("combobox", { name: "End time" }));
  await userEvent.click(page.getByRole("option", { name: "03:45", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Start session" }));
  expect(send).toHaveBeenCalledWith({ session: { mode: "until", endsAt: expect.any(Number) } });
});

it("opens the Settings session menu and exposes authorization actions in each state", async () => {
  const send = vi.fn();
  const authorize = vi.fn();
  const current = status();
  await using screen = await render(
    <KeepAwakeSettingsFields
      status={current}
      disabled={false}
      send={send}
      authorize={authorize}
      localDesktop
    />,
  );
  await userEvent.click(screen.getByRole("combobox", { name: "Default keep-awake session" }));
  await userEvent.click(page.getByRole("option", { name: "Indefinitely", exact: true }));
  expect(send).toHaveBeenCalledWith({ defaults: { ...DEFAULT_KEEP_AWAKE, mode: "indefinite" } });
  await userEvent.click(screen.getByRole("button", { name: "Authorize", exact: true }));
  expect(authorize).toHaveBeenCalledWith("install");
  await screen.rerender(
    <KeepAwakeSettingsFields
      status={{ ...current, lid: { ...current.lid!, authorized: true } }}
      disabled={false}
      send={send}
      authorize={authorize}
      localDesktop
    />,
  );
  await expect.element(screen.getByText("Authorized", { exact: true })).toBeVisible();
  await userEvent.click(
    screen.getByRole("switch", { name: "Keep awake with lid closed", exact: true }),
  );
  expect(send).toHaveBeenCalledWith({
    defaults: {
      ...DEFAULT_KEEP_AWAKE,
      options: { ...DEFAULT_KEEP_AWAKE.options, lidClosed: true },
    },
    options: { ...DEFAULT_KEEP_AWAKE.options, lidClosed: true },
  });
  await userEvent.click(screen.getByRole("button", { name: "Remove authorization" }));
  expect(authorize).toHaveBeenCalledWith("remove");
  await screen.rerender(
    <KeepAwakeSettingsFields
      status={{
        ...current,
        lid: { ...current.lid!, authorized: true, active: true, error: "Could not restore sleep" },
      }}
      disabled={false}
      send={send}
      authorize={authorize}
      localDesktop
    />,
  );
  await expect.element(screen.getByText("Could not restore sleep", { exact: true })).toBeVisible();
});
