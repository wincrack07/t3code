import {
  AuthProvidersManageScope,
  type EnvironmentId,
  PROVIDER_DISPLAY_NAMES,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

import { useEnvironmentProviders, useEnvironments } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentsWithScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  getProviderUpdateRunToastView,
  type ProviderUpdateCandidate,
  type ProviderUpdateRun,
} from "./ProviderUpdateLaunchNotification.logic";
import { Button } from "./ui/button";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

// `refreshModels` always drops the server's hour-long latest-version cache. `modelCatalogOnly`
// drops it only when the model manifest changed.
export function useCheckProviderUpdates() {
  const { environments } = useEnvironments();
  const manageableIds = useEnvironmentsWithScope(environments, AuthProvidersManageScope);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const inFlight = useRef<Promise<void> | null>(null);

  const check = async (quiet: boolean) => {
    const failures = await Promise.all(
      environments
        .filter(
          (environment) =>
            environment.connection.phase === "connected" &&
            manageableIds.has(environment.environmentId),
        )
        .map(async ({ environmentId, label }) => {
          const result = await refreshProviders({ environmentId, input: { refreshModels: true } });
          if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return [];
          const error = squashAtomCommandFailure(result);
          return [`${label}: ${error instanceof Error ? error.message : "Refresh failed."}`];
        }),
    );
    const lines = failures.flat();
    if (quiet || lines.length === 0) return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not check provider updates",
        description: <span className="whitespace-pre-line">{lines.join("\n")}</span>,
      }),
    );
  };

  // A repeat click must not start a second model rediscovery while one is running.
  return ({ quiet = false }: { readonly quiet?: boolean } = {}) => {
    if (inFlight.current) return inFlight.current;
    const running = check(quiet).finally(() => {
      inFlight.current = null;
    });
    inFlight.current = running;
    return running;
  };
}

interface ProviderUpdateListing {
  readonly candidate: ProviderUpdateCandidate;
  readonly oneClick: boolean;
}

// The oldest latest-version check across installed providers; null until every one has checked.
function oldestProviderCheck(providers: ReadonlyArray<ServerProvider>): string | null {
  const checks = providers
    .filter((provider) => provider.enabled && provider.installed)
    .map((provider) => provider.versionAdvisory?.checkedAt ?? null);
  if (checks.length === 0 || checks.includes(null)) return null;
  return checks.reduce((oldest, checkedAt) => (checkedAt! < oldest! ? checkedAt : oldest));
}

export function useProviderUpdates() {
  const { environments } = useEnvironments();
  const manageableIds = useEnvironmentsWithScope(environments, AuthProvidersManageScope);
  const providersByEnvironment = useEnvironmentProviders();
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, {
    reportFailure: false,
  });
  const reachable = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && manageableIds.has(environment.environmentId),
  );
  const uncheckedMachineCount = environments.length - reachable.length;
  const checkedAt = oldestProviderCheck(
    reachable.flatMap(({ environmentId }) => providersByEnvironment.get(environmentId) ?? []),
  );
  // Every candidate on a reachable, manageable machine, including ones only Settings can update.
  const listed = reachable.flatMap((environment) => {
    const providers = providersByEnvironment.get(environment.environmentId) ?? [];
    const candidates = collectProviderUpdateCandidates(providers).map(
      (candidate): ProviderUpdateListing => ({
        candidate,
        oneClick: canOneClickUpdateProviderCandidate(candidate, providers),
      }),
    );
    return candidates.length > 0
      ? [{ environmentId: environment.environmentId, label: environment.label, candidates }]
      : [];
  });
  const machines = listed.flatMap(({ candidates, ...machine }) => {
    const updatable = candidates
      .filter(({ oneClick }) => oneClick)
      .map(({ candidate }) => candidate);
    return updatable.length > 0 ? [{ ...machine, candidates: updatable }] : [];
  });

  /** `only` limits the run to one machine's provider instance. */
  const updateAll = async ({
    quiet = false,
    only,
  }: {
    readonly quiet?: boolean;
    readonly only?: {
      readonly environmentId: EnvironmentId;
      readonly instanceId: ProviderInstanceId;
    };
  } = {}) => {
    const runs = await Promise.all(
      machines.flatMap(({ environmentId, label, candidates }) =>
        (only
          ? candidates.filter(
              (candidate) =>
                environmentId === only.environmentId && candidate.instanceId === only.instanceId,
            )
          : candidates
        ).map(async (candidate): Promise<ProviderUpdateRun> => ({
          environmentId,
          machineLabel: label,
          driver: candidate.driver,
          instanceId: candidate.instanceId,
          result: await updateProvider({
            environmentId,
            input: { provider: candidate.driver, instanceId: candidate.instanceId },
          }),
        })),
      ),
    );
    const view = quiet ? null : getProviderUpdateRunToastView(runs);
    if (view) {
      toastManager.add(
        stackedThreadToast({
          ...view,
          description: <span className="whitespace-pre-line">{view.description}</span>,
        }),
      );
    }
    return runs;
  };

  return {
    machines,
    listed,
    uncheckedMachineCount,
    checkedAt,
    updateAll,
  };
}

export function ProviderUpdatesAction() {
  const { machines, updateAll } = useProviderUpdates();
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  if (machines.length === 0 && !isPending) {
    return null;
  }

  const handleUpdate = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    await settlePromise(() => updateAll());
    pending.current = false;
    setIsPending(false);
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={isPending}
            onClick={() => void handleUpdate()}
          >
            {isPending ? "Updating…" : "Update all"}
          </Button>
        }
      />
      <TooltipPopup side="top">
        {machines.map((machine) => (
          <div key={machine.environmentId}>
            {machine.label}:{" "}
            {machine.candidates
              .map((candidate) => PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver)
              .join(", ")}
          </div>
        ))}
      </TooltipPopup>
    </Tooltip>
  );
}
