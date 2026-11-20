import { DEFAULT_FORK_FEATURE_SWITCHES, type ForkFeatureId } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";

import { Switch } from "../../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settingsLayout";
import { useSearchableSetting } from "../settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "../useScopedSettings";

const FEATURES: ReadonlyArray<{
  readonly id: ForkFeatureId;
  readonly title: string;
  readonly description: string;
}> = [
  {
    id: "tasks",
    title: msg("Tasks"),
    description: msg("Task inbox, board, batch runs and the Tasks panel beside a chat."),
  },
  {
    id: "prReviews",
    title: msg("PR reviews"),
    description: msg("The reviewer that watches GitHub and reviews pull requests in threads."),
  },
  {
    id: "chatHub",
    title: msg("Chat hub"),
    description: msg("Uploads chats to your hub and searches all chats across machines."),
  },
  {
    id: "chatBackup",
    title: msg("Chat backup"),
    description: msg("Export chats as files and restore them from a backup."),
  },
  {
    id: "machineCleanup",
    title: msg("Machine cleanup"),
    description: msg("Frees disk space on demand or on a schedule, for you and for agents."),
  },
  {
    id: "machineMonitor",
    title: msg("Machine monitor"),
    description: msg("CPU, memory and disk in the sidebar and on the monitor page."),
  },
  {
    id: "activityBoard",
    title: msg("Activity board"),
    description: msg("One board with what every connected machine is running."),
  },
  {
    id: "decisions",
    title: msg("Decisions"),
    description: msg("Auto model routing in the model picker."),
  },
  {
    id: "promptSuggestions",
    title: msg("Prompt suggestions"),
    description: msg("Ghost-text completions and suggested replies in the composer."),
  },
  {
    id: "promptPolish",
    title: msg("Polish prompt"),
    description: msg("The polish button and /polish, which rewrite a draft."),
  },
  {
    id: "savedPrompts",
    title: msg("Saved prompts"),
    description: msg("Your prompt library in the chat header and the / menu."),
  },
  {
    id: "openQuestions",
    title: msg("Open questions"),
    description: msg("Decision cards for questions an agent leaves for you."),
  },
  {
    id: "agentStatusLine",
    title: msg("Agent status line"),
    description: msg("A short progress line an agent sets on its thread."),
  },
  {
    id: "pinnedCards",
    title: msg("Pinned cards"),
    description: msg("Live cards an agent pins to Thread details."),
  },
  {
    id: "splitColumns",
    title: msg("Split columns"),
    description: msg("Open threads side by side in resizable columns."),
  },
  {
    id: "moveThreads",
    title: msg("Move threads"),
    description: msg("Move a thread to another project from menus, the palette and drag."),
  },
  {
    id: "projectGroups",
    title: msg("Project groups"),
    description: msg("Sidebar groups, their colors and suggested groups."),
  },
  {
    id: "claudeArtifacts",
    title: msg("Claude artifacts"),
    description: msg("Browse the pages your Claude accounts published."),
  },
  {
    id: "mcpCatalog",
    title: msg("MCP servers"),
    description: msg("The shared MCP catalog that agents reach through T3 Code."),
  },
];

/** On/off for everything only this fork has, saved in each environment's settings. */
export function ForkFeaturesSettings() {
  const gt = useGT();
  const m = useMessages();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const switches = settings.forkFeatures ?? DEFAULT_FORK_FEATURE_SWITCHES;
  const setFeature = (feature: ForkFeatureId, on: boolean) =>
    updateSettings({
      forkFeatures: {
        ...switches,
        off: on
          ? switches.off.filter((candidate) => candidate !== feature)
          : [...switches.off.filter((candidate) => candidate !== feature), feature],
      },
    });
  return (
    <SettingsPageContainer>
      <SettingsSection title={gt("Official mode")}>
        <SettingsRow
          serverScoped
          settingKeys={["forkFeatures"]}
          {...searchableSetting("fork-official-mode")}
          description={gt(
            "Turns off every feature below at once, so this environment behaves like official T3 Code. Your data stays.",
          )}
          control={
            <Switch
              checked={switches.officialMode}
              onCheckedChange={(checked) =>
                updateSettings({ forkFeatures: { ...switches, officialMode: Boolean(checked) } })
              }
              aria-label={gt("Official mode")}
            />
          }
        />
      </SettingsSection>
      <SettingsSection title={gt("Features")}>
        {FEATURES.map((feature) => (
          <SettingsRow
            key={feature.id}
            serverScoped
            settingKeys={["forkFeatures"]}
            title={m(feature.title)}
            description={m(feature.description)}
            control={
              <Switch
                checked={!switches.officialMode && !switches.off.includes(feature.id)}
                disabled={switches.officialMode}
                onCheckedChange={(checked) => setFeature(feature.id, Boolean(checked))}
                aria-label={m(feature.title)}
              />
            }
          />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
