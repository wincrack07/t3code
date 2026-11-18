import { T, useGT } from "gt-react";
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
import { useSearchableSetting } from "./settingsSearch";

type Status = typeof ChatHubStatus.Type;
function MachineHubSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const gt = useGT();
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
        status.enabled ? gt("Sync on") : gt("Sync off"),
        gt("{count} pending", { count: status.pendingCount }),
        gt("last synced {when}", { when: status.lastSuccess ?? gt("never") }),
        ...(status.lastError ? [status.lastError] : []),
      ].join(" · ")
    : gt("Loading…");
  return (
    <SettingsSection
      title={gt("Chat hub · {environment}", {
        environment: readEnvironment(environmentId)?.label ?? environmentId,
      })}
    >
      <SettingsRow
        title={gt("Hub URL")}
        description={gt("The Worker that stores chats from all your machines.")}
        control={
          <Input
            size="sm"
            className="w-full sm:w-64"
            aria-label={gt("Hub URL")}
            value={url}
            disabled={locked}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-hub.workers.dev"
          />
        }
      />
      <SettingsRow
        title={gt("Write token")}
        description={gt("Stays on this machine.")}
        control={
          <Input
            size="sm"
            className="w-full sm:w-64"
            aria-label={gt("Write token")}
            type="password"
            autoComplete="new-password"
            value={token}
            disabled={locked}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              status?.configured ? gt("Saved. Leave blank to keep") : gt("Paste the token")
            }
          />
        }
      />
      <SettingsRow
        title={gt("Sync automatically")}
        description={gt(
          "Uploads this machine's chats. The hub can read them; they aren't end-to-end encrypted.",
        )}
        control={
          <Switch
            aria-label={gt("Enable automatic sync")}
            checked={enabled}
            disabled={locked}
            onCheckedChange={(checked) => setEnabled(checked)}
          />
        }
      />
      <SettingsRow
        title={gt("Status")}
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
                    setMessage(gt("Sync queued. Uploads start within ten seconds."));
                  } else setMessage(gt("Could not queue sync."));
                });
              }}
            >
              <T>Sync now</T>
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
                          ? gt("Saved. Pending chats sync automatically.")
                          : gt("Saved. Automatic sync is off."),
                      );
                    } else setMessage(gt("Could not save hub settings."));
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <T>Save</T>
            </Button>
          </>
        }
      />
    </SettingsSection>
  );
}
export function ChatHubSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const connected = useConnectedEnvironmentIds();
  return (
    <SettingsSearchTarget {...searchableSetting("chat-hub")} className="flex flex-col gap-8">
      {connected.length === 0 ? (
        <SettingsSection title={gt("Chat hub")}>
          <SettingsRow
            title={gt("No environments connected")}
            description={gt("Connect an environment to sync its chats to your hub.")}
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
