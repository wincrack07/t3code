import { Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";

import { Button } from "../../ui/button";
import { ChatBackupSettings } from "../ChatBackupSettings";
import { ChatHubSettings } from "../ChatHubSettings";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settingsLayout";
import { useForkFeature } from "../../../state/forkFeatures";

export function ForkChatsSettings() {
  const gt = useGT();
  const backupOn = useForkFeature("chatBackup");
  const hubOn = useForkFeature("chatHub");
  const artifactsOn = useForkFeature("claudeArtifacts");
  return (
    <SettingsPageContainer>
      {backupOn ? <ChatBackupSettings /> : null}
      {hubOn ? <ChatHubSettings /> : null}
      {hubOn || artifactsOn ? (
        <SettingsSection title={gt("Pages", { $context: "settings section listing app pages" })}>
          {hubOn ? (
            <SettingsRow
              title={gt("All chats")}
              description={gt("Search and read chats from every machine through your chat hub.")}
              control={
                <Button size="sm" variant="outline" render={<Link to="/all-chats" />}>
                  <T context="verb, opens a page">Open</T>
                </Button>
              }
            />
          ) : null}
          {artifactsOn ? (
            <SettingsRow
              title={gt("Artifacts")}
              description={gt("Pages your Claude providers published on claude.ai.")}
              control={
                <Button size="sm" variant="outline" render={<Link to="/artifacts" />}>
                  <T context="verb, opens a page">Open</T>
                </Button>
              }
            />
          ) : null}
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
