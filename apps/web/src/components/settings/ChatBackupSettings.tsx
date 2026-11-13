import { ChatImportSettings } from "./ChatImportSettings";
import { useState } from "react";
import { Button } from "../ui/button";
import { SettingsSection } from "./settingsLayout";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { downloadAllChats } from "../../lib/chatExport";

export function ChatBackupSettings() {
  const connected = useConnectedEnvironmentIds();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  return (
    <SettingsSection id="chat-backup" title="Chat backup">
      <p className="text-sm text-muted-foreground">
        Download chats from every connected environment, including archived chats. Offline
        environments are excluded. Save the ZIP in Google Drive or extract it into an Obsidian
        vault. Attachment files are not included.
      </p>
      <div>
        <Button
          disabled={busy || connected.length === 0}
          onClick={() => {
            setBusy(true);
            setStatus("Preparing export…");
            void downloadAllChats([...connected], (count) => setStatus(`Exporting ${count} chats…`))
              .then(
                (count) => setStatus(`Exported ${count} chats.`),
                () =>
                  setStatus(
                    "Export failed. Check your environment connections and server versions.",
                  ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Export all chats
        </Button>
      </div>
      <ChatImportSettings />
      <p role="status" className="text-sm text-muted-foreground">
        {status}
      </p>
    </SettingsSection>
  );
}
