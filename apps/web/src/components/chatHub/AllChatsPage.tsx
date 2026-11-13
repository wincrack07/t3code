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
import { Button } from "../ui/button";

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
  if (!ready) return <div className="p-6">Finding chat hub…</div>;
  if (!proxy)
    return (
      <div className="p-6">
        <h1 className="text-xl">All chats</h1>
        <p>Connect a machine to your chat hub to search chats from all your environments.</p>
        <Link to="/settings/general">Open settings → Chat backup</Link>
      </div>
    );
  const original = detail
    ? shells.find(
        (t) =>
          t.environmentId === detail.meta.environmentId &&
          t.id === detail.meta.threadId &&
          connected.includes(t.environmentId),
      )
    : undefined;
  return (
    <div className="h-full overflow-auto p-6">
      <h1 className="mb-4 text-xl font-semibold">All chats</h1>
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          aria-label="Search all chats"
          placeholder="Search all chats"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="rounded border bg-background p-2"
        />
        <select
          aria-label="Machine"
          value={machine}
          onChange={(e) => setMachine(e.target.value)}
          className="rounded border bg-background p-2"
        >
          <option value="">All machines</option>
          {machines.map((m) => (
            <option key={m.environmentId} value={m.environmentId}>
              {m.environmentLabel}
            </option>
          ))}
        </select>
        <input
          aria-label="Project filter"
          placeholder="Project (exact title)"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className="rounded border bg-background p-2"
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Include archived
        </label>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
        {busy ? " Loading…" : ""}
      </p>
      <div className="grid gap-6 lg:grid-cols-[minmax(240px,1fr)_2fr]">
        <div>
          {items.map((item) => (
            <button
              key={`${item.environmentId}:${item.threadId}`}
              className="mb-2 block w-full rounded border p-3 text-left hover:bg-accent"
              onClick={() => {
                if (!proxy) return;
                setDetail(undefined);
                void get({
                  environmentId: proxy,
                  input: { environmentId: item.environmentId, threadId: item.threadId },
                }).then((r) => {
                  if (AsyncResult.isSuccess(r)) setDetail(r.value);
                  else setMessage("Could not open chat.");
                });
              }}
            >
              <span className="block font-medium">{item.title}</span>
              <span className="text-xs text-muted-foreground">
                {item.environmentLabel} · {item.projectTitle} · {item.updatedAt}
              </span>
              {item.snippet && <p className="line-clamp-2 text-sm">{item.snippet}</p>}
            </button>
          ))}
          <div ref={sentinel} />
          {cursor && (
            <Button variant="outline" disabled={busy} onClick={loadMore}>
              Load more
            </Button>
          )}
          {!busy && !items.length && <p>No chats found.</p>}
        </div>
        <article>
          {detail ? (
            <>
              <h2 className="text-lg font-semibold">{detail.meta.title}</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                {detail.meta.environmentLabel} · {detail.meta.projectTitle} · {detail.meta.model}
                <br />
                Created {detail.meta.createdAt} · Updated {detail.meta.updatedAt}
              </p>
              <div className="mb-4 flex flex-wrap gap-2">
                {original && (
                  <Button
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
                )}
                <select
                  aria-label="Import destination"
                  className="rounded border bg-background p-2"
                  value={destination ? `${destination.environmentId}:${destination.id}` : ""}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={`${p.environmentId}:${p.id}`} value={`${p.environmentId}:${p.id}`}>
                      {readEnvironment(p.environmentId)?.label} / {p.title}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={!destination || !allowed}
                  onClick={() => {
                    void (async () => {
                      if (!destination) return;
                      const bundle = decodeBundle(detail.bundle);
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
                      setMessage(
                        AsyncResult.isSuccess(r)
                          ? "Imported (existing imports kept)."
                          : "Import failed.",
                      );
                    })().catch(() =>
                      setMessage("Import failed. Configure a destination provider first."),
                    );
                  }}
                >
                  Import to…
                </Button>
              </div>
              <ChatMarkdown text={detail.markdown} cwd={undefined} />
            </>
          ) : (
            <p>Select a chat to read it.</p>
          )}
        </article>
      </div>
    </div>
  );
}
