import { Link } from "@tanstack/react-router";

import { Button } from "../../ui/button";
import { ChatBackupSettings } from "../ChatBackupSettings";
import { ChatHubSettings } from "../ChatHubSettings";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settingsLayout";

export function ForkChatsSettings() {
  return (
    <SettingsPageContainer>
      <ChatBackupSettings />
      <ChatHubSettings />
      <SettingsSection title="Pages">
        <SettingsRow
          title="All chats"
          description="Search and read chats from every machine through your chat hub."
          control={
            <Button size="sm" variant="outline" render={<Link to="/all-chats" />}>
              Open
            </Button>
          }
        />
        <SettingsRow
          title="Artifacts"
          description="Pages your Claude providers published on claude.ai."
          control={
            <Button size="sm" variant="outline" render={<Link to="/artifacts" />}>
              Open
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
