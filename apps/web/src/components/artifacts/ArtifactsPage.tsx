import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import type {
  ClaudeArtifact,
  EnvironmentId,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { EyeIcon, GlobeIcon, LayoutGridIcon, SearchIcon } from "lucide-react";
import { useState, type MouseEvent } from "react";

import { useOpenLink } from "../../browser/useOpenLink";
import { isElectron } from "../../env";
import { useTheme } from "../../hooks/useTheme";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
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

type ArtifactTab = "all" | "mine" | "shared";

const TABS: ReadonlyArray<{ readonly value: ArtifactTab; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "mine", label: "Yours" },
  { value: "shared", label: "Shared with you" },
];
const ALL_ACCOUNTS = "all";

interface ClaudeAccount {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly label: string;
  readonly detail: string | undefined;
}

function claudeAccounts(
  providersByEnvironment: ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>>,
  environmentLabels: ReadonlyMap<EnvironmentId, string>,
): ClaudeAccount[] {
  const showEnvironment = providersByEnvironment.size > 1;
  return [...providersByEnvironment].flatMap(([environmentId, providers]) =>
    providers
      .filter((provider) => provider.driver === "claudeAgent" && provider.enabled)
      .map((provider) => {
        const environmentLabel = showEnvironment ? environmentLabels.get(environmentId) : undefined;
        const detail = [provider.auth.email, environmentLabel].filter(Boolean).join(" · ");
        return {
          key: `${environmentId}:${provider.instanceId}`,
          environmentId,
          instanceId: provider.instanceId,
          label: resolveProviderInstanceDisplayName(provider),
          detail: detail || undefined,
        };
      }),
  );
}

export function ArtifactsPage() {
  const providersByEnvironment = useEnvironmentProviders();
  const { environments } = useEnvironments();
  const environmentLabels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const accounts = claudeAccounts(providersByEnvironment, environmentLabels);
  const [selectedKey, setSelectedKey] = useState<string>(ALL_ACCOUNTS);
  const [tab, setTab] = useState<ArtifactTab>("all");
  const [search, setSearch] = useState("");
  const selected = accounts.filter(
    (account) => selectedKey === ALL_ACCOUNTS || account.key === selectedKey,
  );
  const visible = selected.length > 0 ? selected : accounts;
  const selectedLabel =
    selectedKey === ALL_ACCOUNTS || selected.length === 0
      ? "All accounts"
      : (selected[0]?.label ?? "All accounts");

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="truncate text-sm font-medium">Artifacts</h1>
          {accounts.length > 1 ? (
            <div className="ms-auto shrink-0">
              <Select
                value={selected.length > 0 ? selectedKey : ALL_ACCOUNTS}
                onValueChange={(value) => setSelectedKey(value ?? ALL_ACCOUNTS)}
              >
                <SelectTrigger
                  aria-label="Claude account"
                  size="compact"
                  variant="ghost"
                  className="w-auto min-w-0"
                >
                  <SelectValue>{selectedLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value={ALL_ACCOUNTS}>All accounts</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.key} value={account.key}>
                      {account.detail ? `${account.label} · ${account.detail}` : account.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
        </WorkspacePageHeader>
        {accounts.length === 0 ? (
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
            {visible.map((account) => (
              <AccountArtifacts
                key={account.key}
                account={account}
                tab={tab}
                search={search}
                showHeading={visible.length > 1 || accounts.length > 1}
              />
            ))}
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

function AccountArtifacts(props: {
  account: ClaudeAccount;
  tab: ArtifactTab;
  search: string;
  showHeading: boolean;
}) {
  const { account } = props;
  const query = useEnvironmentQuery(
    serverEnvironment.claudeArtifacts({
      environmentId: account.environmentId,
      input: { instanceId: account.instanceId, limit: 200 },
    }),
  );
  const openLink = useOpenLink(null);
  const dark = useTheme().resolvedTheme === "dark";
  const open = (url: string, event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void openLink(url, { event }).catch(() => undefined);
  };
  const needle = props.search.trim().toLowerCase();
  const artifacts = (query.data?.artifacts ?? []).filter((artifact) =>
    matches(artifact, props.tab, needle),
  );

  return (
    <section aria-label={account.label} className="flex flex-col gap-3 px-4 py-4">
      {props.showHeading ? (
        <h2 className="flex min-w-0 items-baseline gap-2 text-sm font-medium">
          <span className="truncate">{account.label}</span>
          {account.detail ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {account.detail}
            </span>
          ) : null}
        </h2>
      ) : null}
      {query.data === null ? (
        query.error !== null ? (
          <p className="text-sm text-muted-foreground">{query.error}</p>
        ) : (
          <ArtifactGrid>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} shape="card" className="aspect-[16/10]" />
            ))}
          </ArtifactGrid>
        )
      ) : artifacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query.data.artifacts.length === 0
            ? "This account has no artifacts yet."
            : "No artifacts match."}
        </p>
      ) : (
        <>
          <ArtifactGrid>
            {artifacts.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} dark={dark} onOpen={open} />
            ))}
          </ArtifactGrid>
          {query.data.truncated ? (
            <p className="text-xs text-muted-foreground">
              Showing the most recent artifacts Claude returns. Older ones are on claude.ai.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function ArtifactGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">{children}</div>
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

  return (
    <a
      href={artifact.url}
      onClick={(event) => props.onOpen(artifact.url, event)}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="aspect-[16/10] w-full overflow-hidden border-b border-border bg-muted">
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
      <div className="flex min-w-0 flex-col gap-1 p-2.5">
        <span className="truncate text-sm font-medium">{artifact.title}</span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">
            {artifact.relation === "shared" && artifact.ownerEmail
              ? artifact.ownerEmail
              : updated
                ? `Updated ${updated}`
                : ""}
          </span>
          <span className="ms-auto flex shrink-0 items-center gap-2">
            {artifact.viewCount !== undefined ? (
              <span className="flex items-center gap-0.5 tabular-nums">
                <EyeIcon aria-hidden className="size-3" />
                <span aria-label={`${artifact.viewCount} views`}>{artifact.viewCount}</span>
              </span>
            ) : null}
            {artifact.isPublic ? (
              <Tooltip>
                <TooltipTrigger render={<span className="flex items-center" />}>
                  <GlobeIcon aria-label="Public" className="size-3" />
                </TooltipTrigger>
                <TooltipPopup side="top">Anyone with the link can view</TooltipPopup>
              </Tooltip>
            ) : null}
          </span>
        </span>
      </div>
    </a>
  );
}
