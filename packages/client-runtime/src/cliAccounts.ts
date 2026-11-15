import { deriveAvailableInstanceId, deriveInstanceId } from "./providerInstanceIds.ts";
import {
  defaultInstanceIdForDriver,
  isManagedSettingPath,
  ProviderDriverKind,
  ProviderInstanceId,
  type ManagedPolicySummary,
  type ProviderInstanceConfig,
  type ProviderInstanceMutation,
  type ServerSettings,
} from "@t3tools/contracts";

/** Another subscription with its own CLI login in its own folder. */
export const CLI_ACCOUNTS = {
  claudeAgent: { label: "Claude", defaultHome: "~/.claude" },
  codex: { label: "Codex", defaultHome: "~/.codex" },
} as const;

export type CliAccountDriver = keyof typeof CLI_ACCOUNTS;

const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function defaultCliAccountHome(driver: CliAccountDriver, name: string): string {
  return `${CLI_ACCOUNTS[driver].defaultHome}-${slug(name) || "account"}`;
}

// The Codex command logs out of the folder first, so it must never be the default account's.
function isDefaultHome(driver: CliAccountDriver, home: string): boolean {
  const normalized = home
    .trim()
    .replace(/^\$HOME\//, "~/")
    .replace(/\/+$/, "");
  return normalized === CLI_ACCOUNTS[driver].defaultHome;
}

function shellPath(path: string): string {
  if (/^[\w~./-]+$/.test(path)) return path;
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  return path.startsWith("~/") ? `"$HOME"/${quote(path.slice(2))}` : quote(path);
}

/** The sign-in to run on the account's environment. Codex uses a device code, so the browser's
 * signed-in ChatGPT account is not picked up; the code can be opened in a private window. */
export function cliAccountLoginCommand(driver: CliAccountDriver, home: string): string {
  const dir = shellPath(home.trim());
  return driver === "codex"
    ? `mkdir -p ${dir} && CODEX_HOME=${dir} codex logout; CODEX_HOME=${dir} codex login --device-auth`
    : `CLAUDE_CONFIG_DIR=${dir} claude auth login`;
}

/** The colour another instance already uses for an account with this name, whatever its provider,
 * so one account keeps one colour across providers. */
export function suggestCliAccountColor(
  providerInstances: ServerSettings["providerInstances"],
  name: string,
): string | undefined {
  const words = slug(name)
    .split("-")
    .filter((word) => word.length > 0);
  if (words.length === 0) return undefined;
  return Object.values(providerInstances).find((instance) => {
    const label = slug(instance.displayName ?? "").split("-");
    return instance.accentColor !== undefined && words.every((word) => label.includes(word));
  })?.accentColor;
}

export function planCliAccountAdd(input: {
  readonly driver: CliAccountDriver;
  readonly providerInstances: ServerSettings["providerInstances"];
  readonly policy: ManagedPolicySummary | undefined;
  readonly name: string;
  readonly home: string;
  readonly accentColor?: string | undefined;
}): { readonly mutation: ProviderInstanceMutation } | { readonly error: string } {
  const name = input.name.trim();
  const home = input.home.trim();
  if (name.length === 0) return { error: "Enter a name for this account." };
  if (home.length === 0) return { error: "Enter the folder this account signs in with." };
  if (isDefaultHome(input.driver, home)) {
    return { error: `${home} is the default account's folder. Choose another one.` };
  }
  const driver = ProviderDriverKind.make(input.driver);
  const instanceId = ProviderInstanceId.make(
    deriveAvailableInstanceId(
      (label) => deriveInstanceId(driver, label) || driver,
      name,
      new Set([defaultInstanceIdForDriver(driver), ...Object.keys(input.providerInstances)]),
    ),
  );
  if (input.policy && isManagedSettingPath(input.policy, `providerInstances.${instanceId}`)) {
    return { error: `Managed by ${input.policy.organization}.` };
  }
  const instance: ProviderInstanceConfig = {
    driver,
    enabled: true,
    displayName: `${CLI_ACCOUNTS[input.driver].label} - ${name}`,
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    config:
      input.driver === "codex" ? { setupMode: "existing", homePath: home } : { homePath: home },
  };
  return { mutation: { operation: "create", instanceId, instance } };
}
