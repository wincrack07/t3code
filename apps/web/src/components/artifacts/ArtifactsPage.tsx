import { useAtomValue } from "@effect/atom-react";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import type { ClaudeArtifact, ServerProvider } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { EyeIcon, GlobeIcon, LayoutGridIcon, SearchIcon } from "lucide-react";
import { useState, type MouseEvent } from "react";

import { useOpenLink } from "../../browser/useOpenLink";
import { isElectron } from "../../env";
import { useTheme } from "../../hooks/useTheme";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import {
  useConnectedEnvironmentIds,
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  groupClaudeAccounts,
  mergeArtifacts,
  pickAccountListing,
  type ClaudeAccountGroup,
  type ClaudeAccountSource,
  type ClaudeInstanceRow,
} from "./artifacts.logic";

type ArtifactTab = "all" | "mine" | "shared";

const TABS: ReadonlyArray<{ readonly value: ArtifactTab; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "mine", label: "Yours" },
  { value: "shared", label: "Shared with you" },
];
const ALL_ACCOUNTS = "all";
const EMPTY_PROVIDERS: ReadonlyArray<ServerProvider> = [];

const accountsByEnvironmentAtom = environmentAtomList(
  "web-claude-artifact-accounts",
  (environmentId) => serverEnvironment.claudeArtifactAccounts({ environmentId, input: {} }),
);

const sourcesKey = (sources: ReadonlyArray<ClaudeAccountSource>) => JSON.stringify(sources);

// Reads one source at a time, so a healthy account costs one listing request.
const accountListingAtom = Atom.family((key: string) => {
  const sources = JSON.parse(key) as ClaudeAccountSource[];
  return Atom.make((get) =>
    pickAccountListing(sources, (source) =>
      get(
        serverEnvironment.claudeArtifacts({
          environmentId: source.environmentId,
          input: { instanceId: source.instanceId, limit: 200 },
        }),
      ),
    ),
  ).pipe(Atom.withLabel(`web-claude-artifacts:${key}`));
});

const accountListingsAtom = Atom.family((key: string) =>
  Atom.make((get) => (JSON.parse(key) as string[]).map((entry) => get(accountListingAtom(entry)))),
);

function useClaudeAccounts(): { readonly ready: boolean; readonly accounts: ClaudeAccountGroup[] } {
  const providersByEnvironment = useEnvironmentProviders();
  const connected = useConnectedEnvironmentIds();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { presentationById } = useEnvironments();
  const environmentIds = connected.filter((environmentId) =>
    (providersByEnvironment.get(environmentId) ?? EMPTY_PROVIDERS).some(
      (provider) => provider.driver === "claudeAgent" && provider.enabled,
    ),
  );
  const identities = useAtomValue(accountsByEnvironmentAtom(environmentIdsKey(environmentIds)));
  const rows = environmentIds.flatMap((environmentId, index) => {
    const known = AsyncResult.getOrElse(identities[index] ?? AsyncResult.initial(), () => null);
    return (providersByEnvironment.get(environmentId) ?? EMPTY_PROVIDERS)
      .filter((provider) => provider.driver === "claudeAgent" && provider.enabled)
      .map((provider): ClaudeInstanceRow => ({
        environmentId,
        environmentLabel: presentationById.get(environmentId)?.entry.target.label ?? environmentId,
        instanceId: provider.instanceId,
        displayName: resolveProviderInstanceDisplayName(provider),
        email: provider.auth.email?.trim() || undefined,
        account: known?.accounts.find((account) => account.instanceId === provider.instanceId),
      }));
  });
  return {
    // An environment that cannot identify its accounts (an older server) falls back per instance.
    ready: identities.every((result) => !AsyncResult.isInitial(result)),
    accounts: groupClaudeAccounts(rows, primaryEnvironmentId),
  };
}

export function ArtifactsPage() {
  const { ready, accounts } = useClaudeAccounts();
  const [selectedKey, setSelectedKey] = useState<string>(ALL_ACCOUNTS);
  const [tab, setTab] = useState<ArtifactTab>("all");
  const [search, setSearch] = useState("");
  const selectedAccount = accounts.find((account) => account.key === selectedKey);
  const visible = selectedAccount ? [selectedAccount] : accounts;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="truncate text-sm font-medium">Artifacts</h1>
          {accounts.length > 1 ? (
            <div className="ms-auto shrink-0">
              <Select
                value={selectedAccount ? selectedKey : ALL_ACCOUNTS}
                onValueChange={(value) => setSelectedKey(value ?? ALL_ACCOUNTS)}
              >
                <SelectTrigger
                  aria-label="Claude account"
                  size="compact"
                  variant="ghost"
                  className="w-auto min-w-0"
                >
                  <SelectValue>{selectedAccount?.label ?? "All accounts"}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value={ALL_ACCOUNTS}>All accounts</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem
                      key={account.key}
                      value={account.key}
                      title={[
                        account.email,
                        `via ${account.sources.map((source) => source.environmentLabel).join(", ")}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {account.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
        </WorkspacePageHeader>
        {!ready ? (
          <div className="px-4 py-4">
            <ArtifactGridSkeleton />
          </div>
        ) : accounts.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutGridIcon />
              </EmptyMedia>
              <EmptyTitle>No Claude accounts</EmptyTitle>
              <EmptyDescription>
                Add a Claude provider in Settings to see its claude.ai artifacts here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
              <ToggleGroup
                aria-label="Artifact owner"
                variant="segmented"
                value={[tab]}
                onValueChange={(value) => {
                  const next = TABS.find((candidate) => candidate.value === value[0]);
                  if (next) setTab(next.value);
                }}
              >
                {TABS.map((option) => (
                  <Toggle key={option.value} value={option.value}>
                    {option.label}
                  </Toggle>
                ))}
              </ToggleGroup>
              <InputGroup className="ms-auto w-full sm:w-64">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Search artifacts"
                  placeholder="Search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </InputGroup>
            </div>
            <AccountsArtifacts accounts={visible} tab={tab} search={search} />
          </div>
        )}
      </div>
    </SidebarInset>
  );
}

function matches(artifact: ClaudeArtifact, tab: ArtifactTab, query: string) {
  if (tab !== "all" && artifact.relation !== tab) return false;
  return query.length === 0 || artifact.title.toLowerCase().includes(query);
}

function AccountsArtifacts(props: {
  accounts: ReadonlyArray<ClaudeAccountGroup>;
  tab: ArtifactTab;
  search: string;
}) {
  const listings = useAtomValue(
    accountListingsAtom(
      JSON.stringify(props.accounts.map((account) => sourcesKey(account.sources))),
    ),
  );
  const openLink = useOpenLink(null);
  const dark = useTheme().resolvedTheme === "dark";
  const open = (url: string, event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void openLink(url, { event }).catch(() => undefined);
  };
  const loaded = listings.flatMap((listing) =>
    AsyncResult.isSuccess(listing.result) ? [listing.result.value] : [],
  );
  const failures = props.accounts.flatMap((account, index) => {
    const result = listings[index]?.result;
    return result && AsyncResult.isFailure(result)
      ? [{ account, message: formatEnvironmentQueryError(result.cause) }]
      : [];
  });
  const pending = listings.some((listing) => AsyncResult.isInitial(listing.result));
  const all = mergeArtifacts(loaded.map((listing) => listing.artifacts));
  const needle = props.search.trim().toLowerCase();
  const artifacts = all.filter((artifact) => matches(artifact, props.tab, needle));
  const showAccountInFailure = props.accounts.length > 1;

  return (
    <section className="flex flex-col gap-3 px-4 py-4">
      {failures.map(({ account, message }) => (
        <p key={account.key} className="text-sm text-muted-foreground">
          {showAccountInFailure ? `${account.label}: ${message}` : message}
        </p>
      ))}
      {artifacts.length > 0 ? (
        <>
          <ArtifactGrid>
            {artifacts.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} dark={dark} onOpen={open} />
            ))}
          </ArtifactGrid>
          {loaded.some((listing) => listing.truncated) ? (
            <p className="text-xs text-muted-foreground">
              Showing the most recent artifacts Claude returns. Older ones are on claude.ai.
            </p>
          ) : null}
        </>
      ) : pending ? (
        <ArtifactGridSkeleton />
      ) : loaded.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {all.length === 0 ? "No artifacts yet." : "No artifacts match."}
        </p>
      ) : null}
    </section>
  );
}

function ArtifactGridSkeleton() {
  return (
    <ArtifactGrid>
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} shape="card" className="aspect-[2/1]" />
      ))}
    </ArtifactGrid>
  );
}

function ArtifactGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(max(240px,30%),1fr))] gap-6">
      {children}
    </div>
  );
}

function ArtifactCard(props: {
  artifact: ClaudeArtifact;
  dark: boolean;
  onOpen: (url: string, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { artifact } = props;
  const thumbnail = props.dark
    ? (artifact.thumbnailDarkUrl ?? artifact.thumbnailUrl)
    : artifact.thumbnailUrl;
  const updated = artifact.updatedAt ? formatRelativeTimeLabel(artifact.updatedAt) : "";

  const owner =
    artifact.relation === "shared" && artifact.ownerEmail
      ? artifact.ownerEmail
      : updated
        ? `Updated ${updated}`
        : null;
  const meta = [
    owner === null ? null : (
      <span key="owner" className="min-w-0 truncate">
        {owner}
      </span>
    ),
    artifact.viewCount === undefined ? null : (
      <span key="views" className="flex shrink-0 items-center gap-0.5 tabular-nums">
        <EyeIcon aria-hidden className="size-3" />
        <span aria-label={`${artifact.viewCount} views`}>{artifact.viewCount}</span>
      </span>
    ),
    artifact.isPublic ? (
      <Tooltip key="public">
        <TooltipTrigger render={<span className="flex shrink-0 items-center" />}>
          <GlobeIcon aria-label="Public" className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">Anyone with the link can view</TooltipPopup>
      </Tooltip>
    ) : null,
  ].filter((part) => part !== null);

  return (
    <a
      href={artifact.url}
      onClick={(event) => props.onOpen(artifact.url, event)}
      className="group press-spring focus-ring relative flex min-w-0 flex-col overflow-hidden rounded-xl bg-card outline-none ring-1 ring-border after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-foreground/5 after:opacity-0 after:transition-opacity after:duration-75 hover:after:opacity-100 motion-reduce:after:transition-none"
    >
      <div className="aspect-[2/1] w-full overflow-hidden border-b border-border bg-muted">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-full object-cover object-top"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/60">
            <LayoutGridIcon className="size-6" />
          </div>
        )}
      </div>
      <div className="flex min-h-[60px] min-w-0 flex-col justify-center gap-0.5 px-3 py-2.75">
        <span className="truncate text-sm/5 font-medium">{artifact.title}</span>
        {meta.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs/[17px] text-muted-foreground">
            {meta.flatMap((part, index) =>
              index === 0
                ? [part]
                : [
                    <span
                      key={`dot-${part.key}`}
                      aria-hidden
                      className="size-[3px] shrink-0 rounded-full bg-foreground/20"
                    />,
                    part,
                  ],
            )}
          </span>
        ) : null}
      </div>
    </a>
  );
}
