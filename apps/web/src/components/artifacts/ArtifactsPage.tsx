import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthPreviewOperateScope,
  BROWSER_PROFILE_MAX_COUNT,
  BROWSER_PROFILE_NAME_MAX_LENGTH,
  ThreadId,
  resolveBrowserProfiles,
  type ClaudeArtifact,
  type EnvironmentId,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LayoutGridIcon,
  LockIcon,
  MoreHorizontalIcon,
  PanelRightIcon,
  SearchIcon,
} from "lucide-react";
import { useContext, useState, type MouseEvent } from "react";

import { useArtifactRecentsStore } from "../../artifacts/artifactRecentsStore";
import { parseClaudeArtifactUrl } from "../../artifacts/claudeArtifactUrl";
import { openUrlInPreview } from "../../browser/openFileInPreview";
import { previewRuntimeTabId } from "../../browser/previewRuntimeTabId";
import { useOpenLink } from "../../browser/useOpenLink";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { getClientSettings, persistClientSettingsUpdate } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { readThreadPreviewState, useThreadPreviewState } from "../../previewStateStore";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import {
  useConnectedEnvironmentIds,
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { previewEnvironment } from "../../state/preview";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { PreviewPanel } from "../preview/PreviewPanel";
import { previewBridge } from "../preview/previewBridge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  EMPTY_VIEWER_HISTORY,
  accountBrowserProfileId,
  filterArtifacts,
  groupClaudeAccounts,
  mergeArtifacts,
  pickAccountListing,
  stepHistory,
  visitInHistory,
  type ArtifactRelationFilter,
  type ArtifactSort,
  type ClaudeAccountGroup,
  type ClaudeAccountSource,
  type ClaudeInstanceRow,
  type ListedArtifact,
  type ViewerHistory,
} from "./artifacts.logic";

const TABS: ReadonlyArray<{ readonly value: ArtifactRelationFilter; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "mine", label: "Yours" },
  { value: "shared", label: "Shared with you" },
];
const SORTS: ReadonlyArray<{ readonly value: ArtifactSort; readonly label: string }> = [
  { value: "updated", label: "Recently updated" },
  { value: "title", label: "Title" },
];
const ALL_ACCOUNTS = "all";
const EMPTY_PROVIDERS: ReadonlyArray<ServerProvider> = [];
const PAGE_SIZE = 60;
const RECENTS_SHOWN = 6;
// Each viewed artifact keeps a live tab for instant back and forward; older ones close.
const VIEWER_TAB_LIMIT = 4;
// A browser session on this machine that belongs to no thread, so viewing never starts one.
const VIEWER_THREAD_ID = ThreadId.make("claude-artifacts-viewer");
const LISTING_LIMIT = 200;

const accountsByEnvironmentAtom = environmentAtomList(
  "web-claude-artifact-accounts",
  (environmentId) => serverEnvironment.claudeArtifactAccounts({ environmentId, input: {} }),
);

const sourcesKey = (sources: ReadonlyArray<ClaudeAccountSource>) => JSON.stringify(sources);

const listingAtomFor = (source: ClaudeAccountSource) =>
  serverEnvironment.claudeArtifacts({
    environmentId: source.environmentId,
    input: { instanceId: source.instanceId, limit: LISTING_LIMIT },
  });

// Reads one source at a time, so a healthy account costs one listing request.
const accountListingAtom = Atom.family((key: string) => {
  const sources = JSON.parse(key) as ClaudeAccountSource[];
  return Atom.make((get) =>
    pickAccountListing(sources, (source) => get(listingAtomFor(source))),
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

/** Registers the account's own browser profile once; falls back to the default profile when full. */
async function ensureAccountProfile(account: ClaudeAccountGroup): Promise<string | undefined> {
  const id = accountBrowserProfileId(account.key);
  if (resolveBrowserProfiles(getClientSettings().browserProfiles).some((p) => p.id === id)) {
    return id;
  }
  try {
    const settings = await persistClientSettingsUpdate((current) => {
      if (current.browserProfiles.some((profile) => profile.id === id)) return current;
      if (current.browserProfiles.length >= BROWSER_PROFILE_MAX_COUNT) return current;
      const taken = new Set(resolveBrowserProfiles(current.browserProfiles).map((p) => p.name));
      const base = `Claude · ${account.label}`.slice(0, BROWSER_PROFILE_NAME_MAX_LENGTH - 3);
      let name = base;
      for (let index = 2; taken.has(name); index += 1) name = `${base} ${index}`;
      return {
        ...current,
        browserProfiles: [...current.browserProfiles, { id, name, kind: "persistent" as const }],
      };
    });
    return settings.browserProfiles.some((profile) => profile.id === id) ? id : undefined;
  } catch {
    return undefined;
  }
}

const reportOpenFailure = (url: string, cause: unknown): void => {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Could not open the artifact",
      description: cause instanceof Error ? cause.message : url,
    }),
  );
};

export function ArtifactsPage() {
  const { ready, accounts } = useClaudeAccounts();
  const [selectedKey, setSelectedKey] = useState<string>(ALL_ACCOUNTS);
  const [relation, setRelation] = useState<ArtifactRelationFilter>("all");
  const [sort, setSort] = useState<ArtifactSort>("updated");
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<ViewerHistory>(EMPTY_VIEWER_HISTORY);
  const selectedAccount = accounts.find((account) => account.key === selectedKey);
  const visible = selectedAccount ? [selectedAccount] : accounts;

  const listings = useAtomValue(
    accountListingsAtom(JSON.stringify(accounts.map((account) => sourcesKey(account.sources)))),
  );
  const registry = useContext(RegistryContext);
  const fetchFresh = useAtomQueryRunner(serverEnvironment.claudeArtifacts, {
    reportFailure: false,
    refresh: true,
  });
  const [refreshPending, setRefreshPending] = useState(false);
  // The forced read refills the server's cache, so the shown listings then reload from it.
  const refresh = async () => {
    setRefreshPending(true);
    await Promise.all(
      accounts.flatMap((account) =>
        account.sources.map(async (source) => {
          await fetchFresh({
            environmentId: source.environmentId,
            input: { instanceId: source.instanceId, limit: LISTING_LIMIT, refresh: true },
          });
          registry.refresh(listingAtomFor(source));
        }),
      ),
    ).finally(() => setRefreshPending(false));
  };
  const loadedLists = accounts.flatMap((account, index) => {
    const result = listings[index]?.result;
    return result && AsyncResult.isSuccess(result)
      ? [{ accountKey: account.key, artifacts: result.value.artifacts }]
      : [];
  });
  const all = mergeArtifacts(loadedLists);
  const byId = new Map(all.map((entry) => [entry.artifact.id, entry]));
  const accountByKey = new Map(accounts.map((account) => [account.key, account]));
  const refreshing = refreshPending || listings.some((listing) => listing.result.waiting);

  const viewer = useArtifactViewer();
  const openLink = useOpenLink(null);
  const recordRecent = useArtifactRecentsStore((state) => state.record);
  const openExternally = (url: string) => {
    recordRecent(url);
    void openLink(url).catch((cause: unknown) => reportOpenFailure(url, cause));
  };
  const view = async (url: string, nextHistory: (current: ViewerHistory) => ViewerHistory) => {
    if (viewer === null) {
      openExternally(url);
      return;
    }
    setHistory(nextHistory);
    const id = parseClaudeArtifactUrl(url)?.id;
    const listed = id === undefined ? undefined : byId.get(id);
    const account = listed ? accountByKey.get(listed.accountKey) : undefined;
    const profileId =
      accounts.length > 1 && account ? await ensureAccountProfile(account) : undefined;
    await viewer.open(url, profileId);
  };
  const actions: ArtifactActions = {
    view:
      viewer === null ? null : (url) => void view(url, (current) => visitInHistory(current, url)),
    openExternally,
    openInPanel: viewer === null ? null : (url) => void viewer.openInPanel(url),
    copy: (url) => void writeTextToClipboard(url, "link").catch(() => undefined),
  };
  const current = history.urls[history.index];
  const currentId = current === undefined ? undefined : parseClaudeArtifactUrl(current)?.id;
  const step = (delta: -1 | 1) => {
    const next = stepHistory(history, delta);
    const url = next.urls[next.index];
    if (next !== history && url !== undefined) void view(url, () => next);
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="truncate text-sm font-medium">Artifacts</h1>
          <div className="ms-auto flex shrink-0 items-center gap-1">
            {accounts.length > 1 ? (
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
            ) : null}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh artifacts"
              title="Refresh"
              disabled={accounts.length === 0 || refreshPending}
              onClick={() => void refresh()}
            >
              <RefreshIcon refreshing={refreshing} />
            </Button>
          </div>
        </WorkspacePageHeader>
        {!ready ? (
          <div className="px-4 py-4">
            <ArtifactRowsSkeleton />
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
          <div className="flex min-h-0 flex-1">
            <div
              className={
                current !== undefined
                  ? "hidden min-h-0 w-full flex-col border-e border-border md:flex md:w-96 md:shrink-0"
                  : "flex min-h-0 w-full flex-col md:w-96 md:shrink-0 md:border-e md:border-border"
              }
            >
              <div className="flex flex-col gap-2 px-3 pt-3">
                <InputGroup>
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
                <div className="flex items-center gap-2">
                  <ToggleGroup
                    aria-label="Artifact owner"
                    variant="segmented"
                    value={[relation]}
                    onValueChange={(value) => {
                      const next = TABS.find((candidate) => candidate.value === value[0]);
                      if (next) setRelation(next.value);
                    }}
                  >
                    {TABS.map((option) => (
                      <Toggle key={option.value} value={option.value}>
                        {option.label}
                      </Toggle>
                    ))}
                  </ToggleGroup>
                  <div className="ms-auto">
                    <Select
                      value={sort}
                      onValueChange={(value) =>
                        setSort(SORTS.find((option) => option.value === value)?.value ?? "updated")
                      }
                    >
                      <SelectTrigger
                        aria-label="Sort artifacts"
                        size="compact"
                        variant="ghost"
                        className="w-auto min-w-0"
                      >
                        <SelectValue>
                          {SORTS.find((option) => option.value === sort)?.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        {SORTS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
                <AccountStates
                  accounts={visible}
                  results={visible.map(
                    (account) =>
                      listings[accounts.indexOf(account)]?.result ?? AsyncResult.initial(),
                  )}
                />
                {search.trim() === "" && relation === "all" ? (
                  <RecentArtifacts
                    byId={byId}
                    accountByKey={accountByKey}
                    showAccount={accounts.length > 1}
                    currentId={currentId}
                    actions={actions}
                  />
                ) : null}
                <ArtifactList
                  // Paging restarts when the filters change.
                  key={`${selectedKey}\0${relation}\0${sort}\0${search}`}
                  entries={filterArtifacts(
                    selectedAccount
                      ? all.filter((entry) => entry.accountKey === selectedAccount.key)
                      : all,
                    { relation, query: search, sort },
                  )}
                  total={all.length}
                  accountByKey={accountByKey}
                  showAccount={accounts.length > 1 && selectedAccount === undefined}
                  currentId={currentId}
                  truncated={visible.some((account) => {
                    const result = listings[accounts.indexOf(account)]?.result;
                    return result !== undefined && AsyncResult.isSuccess(result)
                      ? result.value.truncated
                      : false;
                  })}
                  actions={actions}
                />
              </div>
            </div>
            {viewer === null ? null : current === undefined ? (
              <div className="hidden min-h-0 flex-1 md:flex">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <LayoutGridIcon />
                    </EmptyMedia>
                    <EmptyTitle>Select an artifact</EmptyTitle>
                    <EmptyDescription>
                      It opens here. Private artifacts ask you to sign in to claude.ai once.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            ) : (
              <ArtifactViewer
                url={current}
                listed={currentId === undefined ? undefined : byId.get(currentId)}
                accountByKey={accountByKey}
                showAccount={accounts.length > 1}
                viewerRef={viewer.threadRef}
                canGoBack={history.index > 0}
                canGoForward={history.index < history.urls.length - 1}
                onStep={step}
                onClose={() => setHistory(EMPTY_VIEWER_HISTORY)}
                actions={actions}
              />
            )}
          </div>
        )}
      </div>
    </SidebarInset>
  );
}

interface ArtifactActions {
  /** Null where this client has no built-in browser; artifacts then open in the system browser. */
  readonly view: ((url: string) => void) | null;
  readonly openExternally: (url: string) => void;
  readonly openInPanel: ((url: string) => void) | null;
  readonly copy: (url: string) => void;
}

function useArtifactViewer(): {
  readonly threadRef: ScopedThreadRef;
  readonly open: (url: string, profileId: string | undefined) => Promise<void>;
  readonly openInPanel: (url: string) => Promise<void>;
} | null {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const canOperate = useEnvironmentScope(primaryEnvironmentId, AuthPreviewOperateScope);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, { reportFailure: false });
  const [tabOrder, setTabOrder] = useState<ReadonlyArray<string>>([]);
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const openThread = useNewThreadHandler();
  // Only the desktop app hosts claude.ai beside the list; claude.ai refuses to be framed.
  if (!isElectron || primaryEnvironmentId === null || !canOperate) return null;
  const threadRef = scopeThreadRef(primaryEnvironmentId, VIEWER_THREAD_ID);

  const open = async (url: string, profileId: string | undefined) => {
    const result = await openUrlInPreview({
      threadRef,
      url,
      openPreview,
      ...(profileId === undefined ? {} : { profileId }),
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        reportOpenFailure(url, squashAtomCommandFailure(result));
      return;
    }
    const state = readThreadPreviewState(threadRef);
    const opened = state.activeTabId;
    if (opened === null) return;
    const order = [opened, ...tabOrder.filter((tabId) => tabId !== opened)];
    const keep = new Set(order.slice(0, VIEWER_TAB_LIMIT));
    setTabOrder(order.slice(0, VIEWER_TAB_LIMIT));
    for (const tabId of Object.keys(state.sessions)) {
      if (keep.has(tabId)) continue;
      void closePreview({
        environmentId: primaryEnvironmentId,
        input: { threadId: VIEWER_THREAD_ID, tabId },
      });
    }
  };

  // The Browser panel lives beside a chat, so this opens one, as links from other apps do.
  const openInPanel = async (url: string) => {
    const environmentId: EnvironmentId | null = scratchEnvironmentId(primaryEnvironmentId);
    if (environmentId === null) return reportOpenFailure(url, undefined);
    const project = await openScratchProject(environmentId, "Could not open the artifact");
    if (!project) return;
    const thread = await openThread(scopeProjectRef(project.environmentId, project.id));
    if (!thread) return reportOpenFailure(url, undefined);
    const result = await openUrlInPreview({
      threadRef: scopeThreadRef(project.environmentId, thread.threadId),
      url,
      openPreview,
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportOpenFailure(url, squashAtomCommandFailure(result));
    }
  };

  return { threadRef, open, openInPanel };
}

function AccountStates(props: {
  readonly accounts: ReadonlyArray<ClaudeAccountGroup>;
  readonly results: ReadonlyArray<
    AsyncResult.AsyncResult<{ readonly artifacts: ReadonlyArray<ClaudeArtifact> }, unknown>
  >;
}) {
  const named = props.accounts.length > 1;
  return props.accounts.map((account, index) => {
    const result = props.results[index]!;
    const message = AsyncResult.isFailure(result)
      ? formatEnvironmentQueryError(result.cause)
      : AsyncResult.isInitial(result)
        ? "Loading artifacts…"
        : result.value.artifacts.length === 0
          ? "No artifacts yet."
          : null;
    if (message === null || (!named && AsyncResult.isInitial(result))) return null;
    return (
      <p key={account.key} className="text-xs text-muted-foreground" role="status">
        {named ? `${account.label}: ${message}` : message}
      </p>
    );
  });
}

function RecentArtifacts(props: {
  readonly byId: ReadonlyMap<string, ListedArtifact>;
  readonly accountByKey: ReadonlyMap<string, ClaudeAccountGroup>;
  readonly showAccount: boolean;
  readonly currentId: string | undefined;
  readonly actions: ArtifactActions;
}) {
  const recents = useArtifactRecentsStore((state) => state.recents);
  const clear = useArtifactRecentsStore((state) => state.clear);
  if (recents.length === 0) return null;
  return (
    <section aria-label="Recent artifacts" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted-foreground">Recent</h2>
        <Button size="compact" variant="ghost-muted" onClick={clear}>
          Clear
        </Button>
      </div>
      {recents.slice(0, RECENTS_SHOWN).map((recent) => {
        const listed = props.byId.get(recent.id);
        return (
          <ArtifactRow
            key={recent.id}
            url={recent.url}
            listed={listed}
            account={listed ? props.accountByKey.get(listed.accountKey) : undefined}
            showAccount={props.showAccount}
            detail={`Opened ${formatRelativeTimeLabel(new Date(recent.openedAt).toISOString())}`}
            current={recent.id === props.currentId}
            actions={props.actions}
          />
        );
      })}
    </section>
  );
}

function ArtifactList(props: {
  readonly entries: ReadonlyArray<ListedArtifact>;
  readonly total: number;
  readonly accountByKey: ReadonlyMap<string, ClaudeAccountGroup>;
  readonly showAccount: boolean;
  readonly currentId: string | undefined;
  readonly truncated: boolean;
  readonly actions: ArtifactActions;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  if (props.entries.length === 0) {
    return props.total > 0 ? (
      <p className="text-sm text-muted-foreground">No artifacts match.</p>
    ) : null;
  }
  return (
    <section aria-label="Artifacts" className="flex flex-col gap-1">
      {props.entries.slice(0, shown).map((entry) => (
        <ArtifactRow
          key={entry.artifact.id}
          url={entry.artifact.url}
          listed={entry}
          account={props.accountByKey.get(entry.accountKey)}
          showAccount={props.showAccount}
          detail={undefined}
          current={entry.artifact.id === props.currentId}
          actions={props.actions}
        />
      ))}
      {props.entries.length > shown ? (
        <Button variant="ghost" size="compact" onClick={() => setShown(shown + PAGE_SIZE)}>
          Show more ({props.entries.length - shown})
        </Button>
      ) : props.truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the most recent artifacts Claude returns. Older ones are on claude.ai.
        </p>
      ) : null}
    </section>
  );
}

function artifactMeta(
  listed: ListedArtifact | undefined,
  account: ClaudeAccountGroup | undefined,
  showAccount: boolean,
  detail: string | undefined,
): string {
  const artifact = listed?.artifact;
  const updated = artifact?.updatedAt
    ? `Updated ${formatRelativeTimeLabel(artifact.updatedAt)}`
    : null;
  return [
    showAccount ? account?.label : null,
    artifact?.relation === "shared" ? (artifact.ownerEmail ?? "Shared with you") : null,
    detail ?? updated,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ArtifactRow(props: {
  readonly url: string;
  readonly listed: ListedArtifact | undefined;
  readonly account: ClaudeAccountGroup | undefined;
  readonly showAccount: boolean;
  readonly detail: string | undefined;
  readonly current: boolean;
  readonly actions: ArtifactActions;
}) {
  const dark = useTheme().resolvedTheme === "dark";
  const artifact = props.listed?.artifact;
  const thumbnail = dark
    ? (artifact?.thumbnailDarkUrl ?? artifact?.thumbnailUrl)
    : artifact?.thumbnailUrl;
  const { view, openExternally } = props.actions;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (view === null || event.metaKey || event.ctrlKey || event.button === 1)
      openExternally(props.url);
    else view(props.url);
  };
  return (
    <div className="group relative flex min-w-0 items-center rounded-lg hover:bg-accent has-aria-[current=page]:bg-accent">
      <a
        href={props.url}
        aria-current={props.current ? "page" : undefined}
        onClick={onClick}
        onAuxClick={(event) => {
          if (event.button === 1) onClick(event);
        }}
        className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 outline-none"
      >
        <div className="flex aspect-[2/1] w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted text-muted-foreground/60">
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
            <LayoutGridIcon className="size-4" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1 text-sm/5 font-medium">
            <span className="truncate">{artifact?.title ?? "Artifact"}</span>
            {artifact ? (
              artifact.isPublic ? (
                <GlobeIcon aria-label="Public" className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <LockIcon aria-label="Private" className="size-3 shrink-0 text-muted-foreground" />
              )
            ) : null}
          </span>
          {artifact?.description ? (
            <span className="truncate text-xs text-muted-foreground">{artifact.description}</span>
          ) : null}
          <span className="truncate text-xs text-muted-foreground">
            {artifactMeta(props.listed, props.account, props.showAccount, props.detail) ||
              props.url}
          </span>
        </div>
      </a>
      <ArtifactActionsMenu url={props.url} actions={props.actions} />
    </div>
  );
}

function ArtifactActionsMenu(props: { readonly url: string; readonly actions: ArtifactActions }) {
  const { view, openInPanel, openExternally, copy } = props.actions;
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="icon-sm" variant="ghost-muted" aria-label="Artifact actions" />}
      >
        <MoreHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        {view ? <MenuItem onClick={() => view(props.url)}>View here</MenuItem> : null}
        {openInPanel ? (
          <MenuItem onClick={() => openInPanel(props.url)}>
            <PanelRightIcon />
            Open in Browser panel
          </MenuItem>
        ) : null}
        <MenuItem onClick={() => openExternally(props.url)}>
          <ExternalLinkIcon />
          Open in default browser
        </MenuItem>
        <MenuItem onClick={() => copy(props.url)}>
          <CopyIcon />
          Copy link
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function ArtifactViewer(props: {
  readonly url: string;
  readonly listed: ListedArtifact | undefined;
  readonly accountByKey: ReadonlyMap<string, ClaudeAccountGroup>;
  readonly showAccount: boolean;
  readonly viewerRef: ScopedThreadRef;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onStep: (delta: -1 | 1) => void;
  readonly onClose: () => void;
  readonly actions: ArtifactActions;
}) {
  const previewState = useThreadPreviewState(props.viewerRef);
  const tabId = previewState.activeTabId;
  const account = props.listed ? props.accountByKey.get(props.listed.accountKey) : undefined;
  const meta = artifactMeta(props.listed, account, true, undefined);
  const reload = () => {
    if (previewBridge && tabId) {
      void previewBridge.refresh(
        previewRuntimeTabId(props.viewerRef, previewState.serverEpoch, tabId),
      );
    }
  };
  return (
    <section aria-label="Artifact viewer" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Back to artifacts"
          className="md:hidden"
          onClick={props.onClose}
        >
          <LayoutGridIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Previous artifact"
          disabled={!props.canGoBack}
          onClick={() => props.onStep(-1)}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Next artifact"
          disabled={!props.canGoForward}
          onClick={() => props.onStep(1)}
        >
          <ArrowRightIcon />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col px-1">
          <span className="truncate text-sm font-medium">
            {props.listed?.artifact.title ?? "Artifact"}
          </span>
          <span className="truncate text-xs text-muted-foreground">{meta || props.url}</span>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Reload artifact"
          title="Reload"
          disabled={!tabId}
          onClick={reload}
        >
          <RefreshIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Copy link"
          title="Copy link"
          onClick={() => props.actions.copy(props.url)}
        >
          <CopyIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Open in default browser"
          title="Open in default browser"
          onClick={() => props.actions.openExternally(props.url)}
        >
          <ExternalLinkIcon />
        </Button>
        {props.actions.openInPanel ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Open in Browser panel"
            title="Open in Browser panel"
            onClick={() => props.actions.openInPanel?.(props.url)}
          >
            <PanelRightIcon />
          </Button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        {tabId ? (
          <PreviewPanel mode="embedded" threadRef={props.viewerRef} tabId={tabId} visible />
        ) : (
          <div className="flex-1 p-4">
            <Skeleton shape="card" className="size-full" />
          </div>
        )}
      </div>
    </section>
  );
}

function ArtifactRowsSkeleton() {
  return (
    <div className="flex flex-col gap-2 md:w-96">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-12" />
      ))}
    </div>
  );
}
