import {
  DEFAULT_FORK_FEATURE_SWITCHES,
  type ForkFeatureId,
  type ForkFeatureSwitches,
} from "@t3tools/contracts";
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
  {
    id: "keepAwake",
    title: msg("Keep awake"),
    description: msg(
      "The keep-awake button, its modes, the menu bar stats and the agent tools. Official keep-awake while agents work stays.",
    ),
  },
  {
    id: "subagentAnswers",
    title: msg("Answer subagents here"),
    description: msg("Answer a subagent's question from its parent thread."),
  },
  {
    id: "cliAccounts",
    title: msg("Provider accounts"),
    description: msg(
      "Add Claude and Codex accounts from their own CLI login, and the Refuseless preset.",
    ),
  },
  {
    id: "moveProjectFolder",
    title: msg("Move project folder"),
    description: msg("Move a project's folder on disk from its settings."),
  },
];

const LOOK: ReadonlyArray<{
  readonly id: ForkFeatureId;
  readonly title: string;
  readonly description: string;
}> = [
  {
    id: "sidebarColors",
    title: msg("Sidebar colors"),
    description: msg("Project and group colors, and the tinted sidebar."),
  },
  {
    id: "sidebarLayout",
    title: msg("Sidebar layout"),
    description: msg(
      "Compact rows, settled threads per project, hidden icons and the sidebar display menu.",
    ),
  },
  {
    id: "appearance",
    title: msg("Appearance extras"),
    description: msg("Density, motion, code themes and the reply font."),
  },
  {
    id: "updateCenter",
    title: msg("Update center"),
    description: msg(
      "Release notes, Check for Updates and provider updates when the app is up to date.",
    ),
  },
  {
    id: "paletteFilters",
    title: msg("Command palette filters"),
    description: msg("The All, Threads, Projects, Actions and Settings tabs in the palette."),
  },
  {
    id: "branding",
    title: msg("Sally"),
    description: msg("Sally in the nightly sidebar sky."),
  },
  {
    id: "multiWindow",
    title: msg("Multiple windows"),
    description: msg("Open threads in new windows, and focus the window that already shows one."),
  },
  {
    id: "finderIntegration",
    title: msg("Finder integration"),
    description: msg("The Send to T3 Code quick action settings."),
  },
  {
    id: "browserExtensions",
    title: msg("Browser extensions"),
    description: msg("Chrome extensions settings for the built-in browser."),
  },
];

/** On/off for everything only this fork has, saved in each environment's settings. */
export function ForkFeaturesSettings() {
  const gt = useGT();
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
      <FeatureSection
        title={gt("Features")}
        features={FEATURES}
        switches={switches}
        onSet={setFeature}
      />
      <FeatureSection
        title={gt("Look and desktop")}
        features={LOOK}
        switches={switches}
        onSet={setFeature}
      />
    </SettingsPageContainer>
  );
}

function FeatureSection(props: {
  title: string;
  features: typeof FEATURES;
  switches: ForkFeatureSwitches;
  onSet: (feature: ForkFeatureId, on: boolean) => void;
}) {
  const m = useMessages();
  const { switches } = props;
  return (
    <SettingsSection title={props.title}>
      {props.features.map((feature) => (
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
              onCheckedChange={(checked) => props.onSet(feature.id, Boolean(checked))}
              aria-label={m(feature.title)}
            />
          }
        />
      ))}
    </SettingsSection>
  );
}
