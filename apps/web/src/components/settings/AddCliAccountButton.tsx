import { useState } from "react";
import { AsyncResult } from "effect/reactivity";
import { PlusIcon } from "lucide-react";
import {
  CLI_ACCOUNTS,
  cliAccountLoginCommand,
  defaultCliAccountHome,
  planCliAccountAdd,
  type CliAccountDriver,
} from "@t3tools/client-runtime/cli-accounts";
import type {
  ManagedPolicySummary,
  ProviderInstanceId,
  ProviderInstanceMutation,
  ServerSettings,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import { SettingsRow } from "./settingsLayout";

const HOME_VARIABLE: Record<CliAccountDriver, string> = {
  claudeAgent: "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME",
};

/** Adds another subscription that signs in with its own CLI login in its own folder. */
export function AddCliAccountButton({
  driver,
  providerInstances,
  policy,
  disabled,
  onSave,
  onCreated,
}: {
  readonly driver: CliAccountDriver;
  readonly providerInstances: ServerSettings["providerInstances"];
  readonly policy: ManagedPolicySummary | undefined;
  readonly disabled: boolean;
  readonly onSave: (
    mutation: ProviderInstanceMutation,
  ) => Promise<AsyncResult.AsyncResult<unknown, unknown>>;
  readonly onCreated: (instanceId: ProviderInstanceId) => void;
}) {
  const { label, defaultHome } = CLI_ACCOUNTS[driver];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Company");
  const [home, setHome] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "command" });
  const folder = home ?? defaultCliAccountHome(driver, name);
  const command = cliAccountLoginCommand(driver, folder);

  const start = () => {
    setName("Company");
    setHome(null);
    setCreated(null);
    setError(null);
    setOpen(true);
  };

  const add = async () => {
    const plan = planCliAccountAdd({ driver, providerInstances, policy, name, home: folder });
    if ("error" in plan) {
      setError(plan.error);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onSave(plan.mutation);
    setBusy(false);
    if (AsyncResult.isSuccess(result)) {
      setCreated(`${label} - ${name.trim()}`);
      onCreated(plan.mutation.instanceId);
    } else if (AsyncResult.isFailure(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not add this account.");
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/25 hover:text-foreground focus-visible:bg-muted/25 focus-visible:text-foreground disabled:cursor-default sm:px-4"
        onClick={start}
      >
        <PlusIcon className="size-4 shrink-0" />
        Add {label} account
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <WizardPopup>
          <WizardHeader
            title={created ?? `Add ${label} account`}
            description={
              created
                ? "Sign in on this environment's machine. The account appears as connected once the login finishes."
                : `A separate ${label} CLI login in its own folder. The default account in ${defaultHome} is not touched.`
            }
          />
          <WizardPanel>
            {created ? (
              <SettingsRow
                title="Sign in"
                description={
                  <>
                    <code className="select-text break-words">{command}</code>
                    <span className="mt-1 block">
                      {driver === "codex"
                        ? "Open the code it prints in a private window and sign in with this account."
                        : "Open the link it prints in a private window and sign in with this account."}
                    </span>
                  </>
                }
                control={
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => copyToClipboard(command, undefined)}
                  >
                    {isCopied ? "Copied" : "Copy command"}
                  </Button>
                }
              />
            ) : (
              <form
                id={`add-${driver}-cli-account`}
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void add();
                }}
              >
                <SettingsRow
                  title="Account name"
                  description={`Shown as "${label} - ${name.trim() || "Name"}".`}
                  control={
                    <Input
                      aria-label="Account name"
                      value={name}
                      disabled={busy}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. Company"
                    />
                  }
                />
                <SettingsRow
                  title="Folder"
                  description={`${HOME_VARIABLE[driver]} for this account.`}
                  control={
                    <Input
                      aria-label="Folder"
                      value={folder}
                      disabled={busy}
                      onChange={(event) => setHome(event.target.value)}
                    />
                  }
                />
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </form>
            )}
          </WizardPanel>
          <WizardFooter>
            {created ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form={`add-${driver}-cli-account`}
                  disabled={busy || disabled}
                >
                  {busy ? "Adding…" : "Continue"}
                </Button>
              </>
            )}
          </WizardFooter>
        </WizardPopup>
      </Dialog>
    </>
  );
}
