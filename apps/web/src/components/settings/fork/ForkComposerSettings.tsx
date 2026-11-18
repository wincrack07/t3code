import { useGT } from "gt-react";
import { DecisionsSettingsSection } from "../DecisionsSettingsSection";
import { PromptPolishSettings } from "../PromptPolishSettings";
import { PromptSuggestionsSettings } from "../PromptSuggestionsSettings";
import { SavedPromptsRow } from "../SavedPromptsSettings";
import { useSettingsScope } from "../SettingsScopeContext";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settingsLayout";

export function ForkComposerSettings() {
  const { scope } = useSettingsScope();
  const gt = useGT();
  if (scope.kind === "project" || scope.kind === "checkout") {
    return (
      <SettingsPageContainer>
        <SettingsSection title={gt("Composer")}>
          <SettingsRow
            title={gt("Environment-wide settings")}
            description={gt(
              "Composer settings apply to a whole environment. Choose an environment above.",
            )}
          />
        </SettingsSection>
      </SettingsPageContainer>
    );
  }
  return (
    <SettingsPageContainer>
      <SettingsSection id="saved-prompts-section" title={gt("Saved prompts")} hideTitle>
        <SavedPromptsRow />
      </SettingsSection>
      <PromptSuggestionsSettings />
      <PromptPolishSettings />
      <DecisionsSettingsSection />
    </SettingsPageContainer>
  );
}
