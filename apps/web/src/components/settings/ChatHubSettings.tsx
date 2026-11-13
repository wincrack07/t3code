import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ChatHubStatus } from "@t3tools/contracts/chat-hub-sync";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useConnectedEnvironmentIds, readEnvironment } from "../../state/environments";
import { Button } from "../ui/button";

type Status = typeof ChatHubStatus.Type;
function MachineHubSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const read = useAtomCommand(serverEnvironment.chatHubStatus, { reportFailure: false });
  const save = useAtomCommand(serverEnvironment.chatHubConfigure, { reportFailure: false });
  const sync = useAtomCommand(serverEnvironment.chatHubSyncNow, { reportFailure: false });
  const allowed = useAtomValue(serverEnvironment.chatHubConfigure.permissionAtom(environmentId));
  const [status, setStatus] = useState<Status>();
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load this environment's persisted hub configuration and refresh worker status.
  useEffect(() => {
    let active = true;
    const load = async (initial: boolean) => {
      const result = await read({ environmentId, input: {} });
      if (active && AsyncResult.isSuccess(result)) {
        setStatus(result.value);
        if (initial) {
          setUrl(result.value.url);
          setEnabled(result.value.enabled);
        }
      }
    };
    void load(true);
    const interval = setInterval(() => void load(false), 10_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [environmentId, read]);
  return (
    <fieldset disabled={!allowed || busy} className="space-y-3 rounded border p-3">
      <legend>{readEnvironment(environmentId)?.label ?? environmentId}</legend>
      <label className="block text-sm">
        Hub URL{" "}
        <input
          aria-label="Hub URL"
          className="w-full rounded border bg-background p-2"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-hub.workers.dev"
        />
      </label>
      <label className="block text-sm">
        Write token{" "}
        <input
          aria-label="Write token"
          type="password"
          autoComplete="new-password"
          className="w-full rounded border bg-background p-2"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={
            status?.configured
              ? "Configured (leave blank to keep)"
              : "Paste this machine's write token"
          }
        />
      </label>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enable automatic sync
      </label>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            setBusy(true);
            void save({ environmentId, input: { url, enabled, ...(token ? { token } : {}) } })
              .then((result) => {
                if (AsyncResult.isSuccess(result)) {
                  setStatus(result.value);
                  setToken("");
                  setMessage("Saved. Backfill starts automatically.");
                } else setMessage("Could not save hub settings.");
              })
              .finally(() => setBusy(false));
          }}
        >
          Save hub settings
        </Button>
        <Button
          variant="outline"
          disabled={!status?.configured || !status.enabled}
          onClick={() => {
            void sync({ environmentId, input: {} }).then((result) => {
              if (AsyncResult.isSuccess(result)) {
                setStatus(result.value);
                setMessage("Sync queued; uploads start within ten seconds.");
              } else setMessage("Could not queue sync.");
            });
          }}
        >
          Sync now
        </Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {status
          ? `${status.enabled ? "Enabled" : "Disabled"} · ${status.pendingCount} pending · Last success: ${status.lastSuccess ?? "never"}`
          : "Loading hub status…"}
        {status?.lastError ? ` · ${status.lastError}` : ""} {message}
      </p>
    </fieldset>
  );
}
export function ChatHubSettings() {
  const connected = useConnectedEnvironmentIds();
  return (
    <div className="space-y-3">
      <h3 className="font-medium">Chat hub</h3>
      <p className="text-sm text-muted-foreground">
        Each machine uploads its own chats. Tokens stay on that server. Cloudflare can read stored
        chats; v1 is not end-to-end encrypted.
      </p>
      {connected.map((environmentId) => (
        <MachineHubSettings key={environmentId} environmentId={environmentId} />
      ))}
    </div>
  );
}
