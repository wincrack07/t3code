import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ChatHubStatus } from "@t3tools/contracts/chat-hub";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useConnectedEnvironmentIds, readEnvironment } from "../../state/environments";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSearchTarget, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

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
  const locked = !allowed || busy;
  const statusLine = status
    ? [
        status.enabled ? "Sync on" : "Sync off",
        `${status.pendingCount} pending`,
        `last synced ${status.lastSuccess ?? "never"}`,
        ...(status.lastError ? [status.lastError] : []),
      ].join(" · ")
    : "Loading…";
  return (
    <SettingsSection title={`Chat hub · ${readEnvironment(environmentId)?.label ?? environmentId}`}>
      <SettingsRow
        title="Hub URL"
        description="The Worker that stores chats from all your machines."
        control={
          <Input
            size="sm"
            className="w-full sm:w-64"
            aria-label="Hub URL"
            value={url}
            disabled={locked}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-hub.workers.dev"
          />
        }
      />
      <SettingsRow
        title="Write token"
        description="Stays on this machine."
        control={
          <Input
            size="sm"
            className="w-full sm:w-64"
            aria-label="Write token"
            type="password"
            autoComplete="new-password"
            value={token}
            disabled={locked}
            onChange={(e) => setToken(e.target.value)}
            placeholder={status?.configured ? "Saved. Leave blank to keep" : "Paste the token"}
          />
        }
      />
      <SettingsRow
        title="Sync automatically"
        description="Uploads this machine's chats. The hub can read them; they aren't end-to-end encrypted."
        control={
          <Switch
            aria-label="Enable automatic sync"
            checked={enabled}
            disabled={locked}
            onCheckedChange={(checked) => setEnabled(checked)}
          />
        }
      />
      <SettingsRow
        title="Status"
        description={statusLine}
        status={message ? <span role="status">{message}</span> : undefined}
        control={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={locked || !status?.configured || !status.enabled}
              onClick={() => {
                void sync({ environmentId, input: {} }).then((result) => {
                  if (AsyncResult.isSuccess(result)) {
                    setStatus(result.value);
                    setMessage("Sync queued. Uploads start within ten seconds.");
                  } else setMessage("Could not queue sync.");
                });
              }}
            >
              Sync now
            </Button>
            <Button
              size="sm"
              disabled={locked}
              onClick={() => {
                setBusy(true);
                void save({ environmentId, input: { url, enabled, ...(token ? { token } : {}) } })
                  .then((result) => {
                    if (AsyncResult.isSuccess(result)) {
                      setStatus(result.value);
                      setToken("");
                      setMessage(
                        result.value.enabled && result.value.configured
                          ? "Saved. Pending chats sync automatically."
                          : "Saved. Automatic sync is off.",
                      );
                    } else setMessage("Could not save hub settings.");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              Save
            </Button>
          </>
        }
      />
    </SettingsSection>
  );
}
export function ChatHubSettings() {
  const connected = useConnectedEnvironmentIds();
  return (
    <SettingsSearchTarget {...searchableSetting("chat-hub")} className="flex flex-col gap-8">
      {connected.length === 0 ? (
        <SettingsSection title="Chat hub">
          <SettingsRow
            title="No environments connected"
            description="Connect an environment to sync its chats to your hub."
          />
        </SettingsSection>
      ) : (
        connected.map((environmentId) => (
          <MachineHubSettings key={environmentId} environmentId={environmentId} />
        ))
      )}
    </SettingsSearchTarget>
  );
}
