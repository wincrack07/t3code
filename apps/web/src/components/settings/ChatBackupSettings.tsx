import { ChatImportSettings } from "./ChatImportSettings";
import { T, useGT } from "gt-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { downloadAllChats } from "../../lib/chatExport";

export function ChatBackupSettings() {
  const gt = useGT();
  const connected = useConnectedEnvironmentIds();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  return (
    <SettingsSection id="chat-backup" title={gt("Chat backup")}>
      <SettingsRow
        title={gt("Export all chats")}
        description={gt(
          "A ZIP of every chat on connected environments, archived ones included, for Google Drive or an Obsidian vault. Attachment files are left out.",
        )}
        status={status ? <span role="status">{status}</span> : null}
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={busy || connected.length === 0}
            onClick={() => {
              setBusy(true);
              setStatus(gt("Preparing export…"));
              void downloadAllChats([...connected], (count) =>
                setStatus(gt("Exporting {count} chats…", { count })),
              )
                .then(
                  (count) => setStatus(gt("Exported {count} chats", { count })),
                  () =>
                    setStatus(
                      gt("Export failed. Check your environment connections and server versions."),
                    ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <T $context="verb">Export</T>
          </Button>
        }
      />
      <ChatImportSettings />
    </SettingsSection>
  );
}
