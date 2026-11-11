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
    <SettingsSection title="Link all my environments to each other">
      <SettingsRow
        title="Link every connected machine in both directions"
        description="Uses this app's sessions to create one pairing code per direction. Links that last more than five days are kept. Failed directions can be retried independently by linking again."
      >
        <div className="space-y-4">
          <LinkAccessPicker value={access} onChange={setAccess} disabled={busy} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !permissions.link}
              onClick={() => void runPeerMesh(false, access)}
            >
              {busy ? "Working…" : "Link all my environments to each other"}
            </Button>
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={busy || !permissions.unlink}
              onClick={() => void runPeerMesh(false, access, true)}
            >
              Unlink all
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Unlink all stops renewal and forgets links between connected machines. Offline machines
            keep their links until you connect and unlink them. Revoke sessions in the destination's
            Sharing & access to end access there too.
          </p>
        </div>
      </SettingsRow>
      <SettingsRow
        title="Keep links renewed"
        description="Renew this app’s links in their last five days while both machines are connected. Access and thread ownership stay the same. Forgotten, revoked or expired links need a fresh click."
      >
        <Switch
          checked={settings.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => setSettings((current) => ({ ...current, enabled }))}
          aria-label="Keep links renewed"
        />
      </SettingsRow>
      {progress.length > 0 ? (
        <div className="space-y-2 p-4" role="status" aria-live="polite">
          {progress.map((pair) => (
            <p key={pair.key} className="text-xs">
              <span className="font-medium">{pair.label}</span>: {pair.status}
            </p>
          ))}
        </div>
      ) : null}
    </SettingsSection>
  );
}
