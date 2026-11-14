import { useState } from "react";
import { AsyncResult } from "effect/reactivity";
import { PlusIcon } from "lucide-react";
import {
  claudeSubscriptionLoginCommand,
  planClaudeAccountSave,
} from "@t3tools/client-runtime/claude-accounts";
import type {
  EnvironmentId,
  ManagedPolicySummary,
  ProviderInstanceId,
  ProviderInstanceMutation,
  ServerSettings,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { toastManager } from "../ui/toast";

export function AddClaudeAccountButton({
  environmentId,
  providerInstances,
  policy,
  disabled,
  onSave,
  onCreated,
}: {
  readonly environmentId: EnvironmentId;
  readonly providerInstances: ServerSettings["providerInstances"];
  readonly policy: ManagedPolicySummary | undefined;
  readonly disabled: boolean;
  readonly onSave: (
    mutation: ProviderInstanceMutation,
  ) => Promise<AsyncResult.AsyncResult<unknown, unknown>>;
  readonly onCreated: (instanceId: ProviderInstanceId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Company");
  const [configDir, setConfigDir] = useState("~/.claude-company");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const command = claudeSubscriptionLoginCommand(configDir);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/25 hover:text-foreground focus-visible:bg-muted/25 focus-visible:text-foreground disabled:cursor-default sm:px-4"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <PlusIcon className="size-4 shrink-0" />
        Add Claude account
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Add Claude account</DialogTitle>
            <DialogDescription>
              A separate Claude Code login, the same idea as a second Codex account. Sign in with
              the company subscription in this folder. The default ~/.claude account stays as it is.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`claude-account-name-${environmentId}`}>Name</Label>
                <Input
                  id={`claude-account-name-${environmentId}`}
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`claude-account-dir-${environmentId}`}>Config folder</Label>
                <Input
                  id={`claude-account-dir-${environmentId}`}
                  value={configDir}
                  disabled={busy}
                  onChange={(event) => setConfigDir(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Sign in on this environment</p>
                <p className="break-all font-mono text-xs text-muted-foreground">{command}</p>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || disabled}
              onClick={() => {
                const plan = planClaudeAccountSave({
                  providerInstances,
                  policy,
                  instanceId: null,
                  draft: { name, configDir },
                });
                if ("error" in plan) {
                  setError(plan.error);
                  return;
                }
                setBusy(true);
                setError(null);
                void onSave(plan.mutation).then((result) => {
                  setBusy(false);
                  if (AsyncResult.isSuccess(result)) {
                    setOpen(false);
                    onCreated(plan.mutation.instanceId);
                    toastManager.add({
                      type: "success",
                      title: "Claude account added",
                      description: command,
                    });
                  } else if (AsyncResult.isFailure(result)) {
                    const failure = squashAtomCommandFailure(result);
                    setError(
                      failure instanceof Error ? failure.message : "Could not add this account.",
                    );
                  }
                });
              }}
            >
              {busy ? "Adding…" : "Add account"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
