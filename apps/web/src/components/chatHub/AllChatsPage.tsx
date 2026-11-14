import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { type EnvironmentId, T3ThreadExport } from "@t3tools/contracts";
import type { ChatHubList, ChatHubThread } from "@t3tools/contracts/chat-hub";

import { serverEnvironment } from "../../state/server";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import {
  useConnectedEnvironmentIds,
  readEnvironment,
  useEnvironmentProviders,
} from "../../state/environments";
import { useProjects, useServerConfigs, useQuietThreadShells } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { buildThreadRouteParams } from "../../threadRoutes";
import ChatMarkdown from "../ChatMarkdown";
import { ArrowLeftIcon, MessagesSquareIcon, SearchIcon } from "lucide-react";
import { isElectron } from "../../env";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

const decodeBundle = Schema.decodeUnknownSync(T3ThreadExport);
type Item = (typeof ChatHubList.Type.items)[number];
type Detail = typeof ChatHubThread.Type & { markdown: string };
export function AllChatsPage() {
  const connected = useConnectedEnvironmentIds();
  const primary = useAtomValue(primaryEnvironmentIdAtom);
  const status = useAtomCommand(serverEnvironment.chatHubStatus, { reportFailure: false });
  const list = useAtomCommand(serverEnvironment.chatHubList, { reportFailure: false });
  const get = useAtomCommand(serverEnvironment.chatHubGet, { reportFailure: false });
  const environments = useAtomCommand(serverEnvironment.chatHubEnvironments, {
    reportFailure: false,
  });
  const runImport = useAtomCommand(orchestrationEnvironment.importThread, { reportFailure: false });
  const projects = useProjects().filter((p) => connected.includes(p.environmentId));
  const configs = useServerConfigs();
  const providers = useEnvironmentProviders();
  const shells = useQuietThreadShells();
  const navigate = useNavigate();
  const [proxy, setProxy] = useState<EnvironmentId | null>(null);
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState("");
  const [machine, setMachine] = useState("");
  const [project, setProject] = useState("");
  const [archived, setArchived] = useState(false);
  const [machines, setMachines] = useState<
    ReadonlyArray<{ environmentId: string; environmentLabel: string }>
  >([]);
  const [items, setItems] = useState<ReadonlyArray<Item>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>();
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const destination = projects.find((p) => `${p.environmentId}:${p.id}` === target) ?? projects[0];
  const allowed = useAtomValue(
    orchestrationEnvironment.importThread.permissionAtom(destination?.environmentId ?? null),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Discover a connected server that can proxy the hub without exposing its token.
  useEffect(() => {
    let active = true;
    void (async () => {
      const ids = [...connected].sort((a, b) => Number(b === primary) - Number(a === primary));
      let found: EnvironmentId | null = null;
      for (const environmentId of ids) {
        const r = await status({ environmentId, input: {} });
        if (AsyncResult.isSuccess(r) && r.value.configured) {
          found = environmentId;
          break;
        }
      }
      if (active) {
        setProxy(found);
        setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [connected, primary, status]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch hub machine filters through the chosen server.
  useEffect(() => {
    let active = true;
    if (proxy)
      void environments({ environmentId: proxy, input: {} }).then((r) => {
        if (active && AsyncResult.isSuccess(r)) setMachines(r.value.items);
      });
    return () => {
      active = false;
    };
  }, [proxy, environments]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Debounce remote search and discard responses from superseded filters.
  useEffect(() => {
    const current = ++generation.current;
    if (!proxy) return;
    const timer = setTimeout(() => {
      setItems([]);
      setCursor(null);
      setBusy(true);
      void list({
        environmentId: proxy,
        input: { q, environmentId: machine, project, includeArchived: archived },
      })
        .then((r) => {
          if (current !== generation.current) return;
          if (AsyncResult.isSuccess(r)) {
            setItems(r.value.items);
            setCursor(r.value.nextCursor);
            setMessage("");
          } else setMessage("Could not load chats. Check the proxy machine's hub settings.");
        })
        .finally(() => {
          if (current === generation.current) setBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [proxy, q, machine, project, archived, list]);
  const loadMore = () => {
    if (!proxy || !cursor || busy) return;
    const current = generation.current;
    setBusy(true);
    void list({
      environmentId: proxy,
      input: { q, environmentId: machine, project, includeArchived: archived, cursor },
    })
      .then((r) => {
        if (current === generation.current && AsyncResult.isSuccess(r)) {
          setItems((old) => [
            ...old,
            ...r.value.items.filter(
              (item) =>
                !old.some(
                  (o) => o.environmentId === item.environmentId && o.threadId === item.threadId,
                ),
            ),
          ]);
          setCursor(r.value.nextCursor);
        }
      })
      .finally(() => {
        if (current === generation.current) setBusy(false);
      });
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Request the next hub cursor when the scroll sentinel becomes visible.
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);
  const original = detail
    ? shells.find(
        (t) =>
          t.environmentId === detail.meta.environmentId &&
          t.id === detail.meta.threadId &&
          connected.includes(t.environmentId),
      )
    : undefined;
  const destinationKey = destination ? `${destination.environmentId}:${destination.id}` : "";
  const destinationLabel = (p: (typeof projects)[number]) =>
    `${readEnvironment(p.environmentId)?.label ?? p.environmentId} / ${p.title}`;
  const openItem = (item: Item) => {
    if (!proxy) return;
    setDetail(undefined);
    void get({
      environmentId: proxy,
      input: { environmentId: item.environmentId, threadId: item.threadId },
    }).then((r) => {
      if (AsyncResult.isSuccess(r)) setDetail(r.value);
      else setMessage("Could not open chat.");
    });
  };
  const importDetail = (current: Detail) => {
    void (async () => {
      if (!destination) return;
      const bundle = decodeBundle(current.bundle);
      const config = configs.get(destination.environmentId);
      if (!config) throw Error();
      const modelSelection =
        destination.defaultModelSelection ??
        config.settings.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(
          providers.get(destination.environmentId) ?? [],
          config.settings,
          destination.id,
        );
      if (!modelSelection) throw Error();
      const r = await runImport({
        environmentId: destination.environmentId,
        input: { bundle, projectId: destination.id, modelSelection },
      });
      setMessage(AsyncResult.isSuccess(r) ? "Imported (existing imports kept)." : "Import failed.");
    })().catch(() => setMessage("Import failed. Configure a destination provider first."));
  };
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="truncate text-sm font-medium">All chats</h1>
          {proxy ? (
            <span className="truncate text-xs text-muted-foreground">
              Through {readEnvironment(proxy)?.label ?? "your hub"}
            </span>
          ) : null}
        </WorkspacePageHeader>
        {!ready ? (
          <div className="flex flex-col gap-2 p-3 md:w-96">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-14" />
            ))}
          </div>
        ) : !proxy ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessagesSquareIcon />
              </EmptyMedia>
              <EmptyTitle>No chat hub yet</EmptyTitle>
              <EmptyDescription>
                Connect a machine to your chat hub to search chats from all your environments.
              </EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" render={<Link to="/settings/fork/chats" hash="chat-hub" />}>
              Set up chat hub
            </Button>
          </Empty>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div
              className={cn(
                "min-h-0 w-full flex-col md:flex md:w-96 md:shrink-0 md:border-e md:border-border",
                detail ? "hidden" : "flex",
              )}
            >
              <div className="flex flex-col gap-2 px-3 pt-3">
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Search all chats"
                    placeholder="Search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </InputGroup>
                <div className="flex items-center gap-2">
                  <Select value={machine} onValueChange={(value) => setMachine(value ?? "")}>
                    <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Machine">
                      <SelectValue>
                        {() =>
                          machines.find((m) => m.environmentId === machine)?.environmentLabel ??
                          "All machines"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="start" alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value="">
                        All machines
                      </SelectItem>
                      {machines.map((m) => (
                        <SelectItem hideIndicator key={m.environmentId} value={m.environmentId}>
                          {m.environmentLabel}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Input
                    size="sm"
                    className="min-w-0 flex-1"
                    aria-label="Project filter"
                    placeholder="Project title"
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                  />
                </div>
                <label className="flex min-h-8 items-center justify-between gap-2 text-sm text-muted-foreground">
                  Include archived
                  <Switch size="sm" checked={archived} onCheckedChange={(checked) => setArchived(checked)} />
                </label>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
                {message || busy ? (
                  <p role="status" className="px-2 pb-1 text-xs text-muted-foreground">
                    {message || "Loading…"}
                  </p>
                ) : null}
                {items.map((item) => {
                  const current =
                    detail?.meta.environmentId === item.environmentId &&
                    detail.meta.threadId === item.threadId;
                  return (
                    <button
                      type="button"
                      key={`${item.environmentId}:${item.threadId}`}
                      aria-current={current ? "page" : undefined}
                      className="focus-ring flex min-w-0 flex-col gap-0.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent aria-[current=page]:bg-accent"
                      onClick={() => openItem(item)}
                    >
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {item.environmentLabel} · {item.projectTitle} ·{" "}
                        {formatRelativeTimeLabel(item.updatedAt)}
                      </span>
                      {item.snippet ? (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {item.snippet}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                <div ref={sentinel} />
                {cursor ? (
                  <Button
                    size="sm"
                    variant="ghost-muted"
                    className="self-center"
                    disabled={busy}
                    onClick={loadMore}
                  >
                    Load more
                  </Button>
                ) : null}
                {!busy && !items.length ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No chats found
                  </p>
                ) : null}
              </div>
            </div>
            {detail ? (
              <article className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="md:hidden"
                      aria-label="Back to chats"
                      onClick={() => setDetail(undefined)}
                    >
                      <ArrowLeftIcon />
                    </Button>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <h2 className="truncate text-base font-medium">{detail.meta.title}</h2>
                      <p className="truncate text-xs text-muted-foreground">
                        {detail.meta.environmentLabel} · {detail.meta.projectTitle} ·{" "}
                        {detail.meta.model} · updated {formatRelativeTimeLabel(detail.meta.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {original ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void navigate({
                            to: "/$environmentId/$threadId",
                            params: buildThreadRouteParams({
                              environmentId: original.environmentId,
                              threadId: original.id,
                            }),
                          })
                        }
                      >
                        Open original
                      </Button>
                    ) : null}
                    <div className="ms-auto flex min-w-0 items-center gap-2">
                      <Select
                        value={destinationKey}
                        onValueChange={(value) => {
                          if (value) setTarget(value);
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-full sm:w-56"
                          aria-label="Import destination"
                          disabled={projects.length === 0}
                        >
                          <SelectValue>
                            {() => (destination ? destinationLabel(destination) : "No projects")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup align="end" alignItemWithTrigger={false}>
                          {projects.map((p) => (
                            <SelectItem
                              hideIndicator
                              key={`${p.environmentId}:${p.id}`}
                              value={`${p.environmentId}:${p.id}`}
                            >
                              {destinationLabel(p)}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      <Button
                        size="sm"
                        disabled={!destination || !allowed}
                        onClick={() => importDetail(detail)}
                      >
                        Import
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  <div className="mx-auto max-w-3xl">
                    <ChatMarkdown text={detail.markdown} cwd={undefined} />
                  </div>
                </div>
              </article>
            ) : (
              <div className="hidden min-h-0 flex-1 md:flex">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessagesSquareIcon />
                    </EmptyMedia>
                    <EmptyTitle>Select a chat</EmptyTitle>
                    <EmptyDescription>
                      It opens here. Import it to continue it on one of your projects.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            )}
          </div>
        )}
      </div>
    </SidebarInset>
  );
}
