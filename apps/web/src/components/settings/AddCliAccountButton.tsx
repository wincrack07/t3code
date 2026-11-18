import { msg, T, useGT, Var } from "gt-react";
import { useState } from "react";
import { AsyncResult } from "effect/reactivity";
import { PlusIcon } from "lucide-react";
import {
  CLI_ACCOUNTS,
  cliAccountLoginCommand,
  defaultCliAccountHome,
  planCliAccountAdd,
  suggestCliAccountColor,
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
import { ProviderAccentColorPicker } from "./ProviderAccentColorPicker";
import { m } from "../../i18n/messages";
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
  const gt = useGT();
  const { label, defaultHome } = CLI_ACCOUNTS[driver];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Company");
  const [home, setHome] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "command",
      unavailableMessage: msg("Clipboard API is unavailable while copying command."),
      failureMessage: msg("Failed to copy command to the clipboard."),
    },
  });
  const folder = home ?? defaultCliAccountHome(driver, name);
  const accentColor = color ?? suggestCliAccountColor(providerInstances, name);
  const command = cliAccountLoginCommand(driver, folder);

  const start = () => {
    setName("Company");
    setHome(null);
    setColor(null);
    setCreated(null);
    setError(null);
    setOpen(true);
  };

  const add = async () => {
    const plan = planCliAccountAdd(
      {
        driver,
        providerInstances,
        policy,
        name,
        home: folder,
        accentColor,
      },
      m,
    );
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
      setError(failure instanceof Error ? failure.message : gt("Could not add this account."));
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
        <T>
          Add <Var>{label}</Var> account
        </T>
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <WizardPopup>
          <WizardHeader
            title={created ?? gt("Add {label} account", { label })}
            description={
              created
                ? gt(
                    "Sign in on this environment's machine. The account appears as connected once the login finishes.",
                  )
                : gt(
                    "A separate {label} CLI login in its own folder. The default account in {defaultHome} is not touched.",
                    { label, defaultHome },
                  )
            }
          />
          <WizardPanel>
            {created ? (
              <SettingsRow
                title={gt("Sign in", { $context: "step title" })}
                description={
                  <>
                    <code className="select-text break-words">{command}</code>
                    <span className="mt-1 block">
                      {driver === "codex"
                        ? gt(
                            "Enter the code it prints, sign in and choose this account's workspace. Plans tell accounts with the same email apart, for example Team and Pro.",
                          )
                        : gt(
                            "Open the link it prints in a private window and sign in with this account.",
                          )}
                    </span>
                  </>
                }
                control={
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => copyToClipboard(command, undefined)}
                  >
                    {isCopied
                      ? gt("Copied", { $context: "copy button state" })
                      : gt("Copy command")}
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
                  title={gt("Account name")}
                  description={
                    name.trim()
                      ? gt('Shown as "{label} - {name}".', { label, name: name.trim() })
                      : gt('Shown as "{label} - Name".', { label })
                  }
                  control={
                    <Input
                      aria-label={gt("Account name")}
                      value={name}
                      disabled={busy}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={gt("e.g. Company")}
                    />
                  }
                />
                <SettingsRow
                  title={gt("Color", { $context: "settings row title, account accent color" })}
                  description={gt(
                    "Matches other accounts with this name. One account keeps one color.",
                  )}
                  control={
                    <ProviderAccentColorPicker
                      layout="inline"
                      displayName={`${label} - ${name.trim() || "Name"}`}
                      value={accentColor}
                      onCommit={(value) => setColor(value)}
                    />
                  }
                />
                <SettingsRow
                  title={gt("Folder", { $context: "settings row title, account config folder" })}
                  description={gt("{variable} for this account.", {
                    variable: HOME_VARIABLE[driver],
                  })}
                  control={
                    <Input
                      aria-label={gt("Folder", {
                        $context: "settings row title, account config folder",
                      })}
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
              <Button onClick={() => setOpen(false)}>
                <T $context="button, close the dialog">Done</T>
              </Button>
            ) : (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                  <T $context="verb, button">Cancel</T>
                </Button>
                <Button
                  type="submit"
                  form={`add-${driver}-cli-account`}
                  disabled={busy || disabled}
                >
                  {busy ? gt("Adding…") : gt("Continue", { $context: "verb, button" })}
                </Button>
              </>
            )}
          </WizardFooter>
        </WizardPopup>
      </Dialog>
    </>
  );
}
