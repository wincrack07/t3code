import { ChatHubSettings } from "./ChatHubSettings";
import { ChatImportSettings } from "./ChatImportSettings";
import { useState } from "react";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { downloadAllChats } from "../../lib/chatExport";

export function ChatBackupSettings() {
  const connected = useConnectedEnvironmentIds();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  return (
    <SettingsSection id="chat-backup" title="Chat backup">
      <SettingsRow
        title="Export all chats"
        description="A ZIP of every chat on connected environments, archived ones included, for Google Drive or an Obsidian vault. Attachment files are left out."
        status={status ? <span role="status">{status}</span> : null}
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={busy || connected.length === 0}
            onClick={() => {
              setBusy(true);
              setStatus("Preparing export…");
              void downloadAllChats([...connected], (count) =>
                setStatus(`Exporting ${count} chats…`),
              )
                .then(
                  (count) => setStatus(`Exported ${count} chats`),
                  () =>
                    setStatus(
                      "Export failed. Check your environment connections and server versions.",
                    ),
                )
                .finally(() => setBusy(false));
            }}
          >
            Export
          </Button>
        }
      />
      <ChatImportSettings />
      <div className="px-3 py-3 sm:px-4">
        <ChatHubSettings />
      </div>
    </SettingsSection>
  );
}
