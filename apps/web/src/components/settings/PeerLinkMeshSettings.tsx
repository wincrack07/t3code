import { useAtomValue } from "@effect/atom-react";
import type { AuthMcpClientAccess } from "@t3tools/contracts";
import { useState } from "react";
import {
  peerMeshBusyAtom,
  peerMeshProgressAtom,
  peerMeshPermissionsAtom,
  runPeerMesh,
  usePeerMeshSettings,
} from "~/state/peerLinkMesh";
import { usePeerLinkHosts } from "~/state/peerLinks";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { LinkAccessPicker } from "./LinkAccessPicker";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function PeerLinkMeshSettings() {
  const hosts = usePeerLinkHosts();
  const [settings, setSettings] = usePeerMeshSettings();
  const [access, setAccess] = useState<AuthMcpClientAccess>("approval-required");
  const busy = useAtomValue(peerMeshBusyAtom);
  const permissions = useAtomValue(peerMeshPermissionsAtom);
  const progress = useAtomValue(peerMeshProgressAtom);
  if (hosts.length < 2 && settings.managed.length === 0) return null;
  return (
    <SettingsSection title="Link my environments">
      <SettingsRow
        title="Link every environment"
        description="Links each connected environment to every other one, in both directions. Run it again to retry any that failed."
        control={
          <Button
            size="sm"
            disabled={busy || !permissions.link}
            onClick={() => void runPeerMesh(false, access)}
          >
            {busy ? "Linking…" : "Link all"}
          </Button>
        }
      >
        <div className="mt-3 max-w-2xl pb-3.5">
          <LinkAccessPicker value={access} onChange={setAccess} disabled={busy} />
        </div>
      </SettingsRow>
      <SettingsRow
        title="Keep links renewed"
        description="Renews links in their last five days while both environments are connected. Forgotten, revoked or expired links need linking again."
        control={
          <Switch
            checked={settings.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => setSettings((current) => ({ ...current, enabled }))}
            aria-label="Keep links renewed"
          />
        }
      />
      <SettingsRow
        title="Unlink all"
        description="Stops renewal and forgets links between connected environments. Offline ones keep their links until they reconnect. To end access on the other side too, revoke the session in its Sharing & access."
        control={
          <Button
            size="sm"
            variant="destructive-outline"
            disabled={busy || !permissions.unlink}
            onClick={() => void runPeerMesh(false, access, true)}
          >
            Unlink all
          </Button>
        }
      />
      {progress.length > 0 ? (
        <SettingsRow title="Progress">
          <ul className="mt-2 space-y-1 pb-2.5 text-xs" role="status" aria-live="polite">
            {progress.map((pair) => (
              <li key={pair.key} className="text-muted-foreground">
                <span className="text-foreground">{pair.label}</span>
                <span className="ps-2">{pair.status}</span>
              </li>
            ))}
          </ul>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}
