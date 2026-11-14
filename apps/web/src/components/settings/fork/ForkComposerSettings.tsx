import { DecisionsSettingsSection } from "../DecisionsSettingsSection";
import { PromptPolishSettings } from "../PromptPolishSettings";
import { PromptSuggestionsSettings } from "../PromptSuggestionsSettings";
import { SavedPromptsRow } from "../SavedPromptsSettings";
import { useSettingsScope } from "../SettingsScopeContext";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settingsLayout";

export function ForkComposerSettings() {
  const { scope } = useSettingsScope();
  if (scope.kind === "project" || scope.kind === "checkout") {
    return (
      <SettingsPageContainer>
        <SettingsSection title="Composer">
          <SettingsRow
            title="Environment-wide settings"
            description="Composer settings apply to a whole environment. Choose an environment above."
          />
        </SettingsSection>
      </SettingsPageContainer>
    );
  }
  return (
    <SettingsPageContainer>
      <SettingsSection id="saved-prompts-section" title="Saved prompts">
        <SavedPromptsRow />
      </SettingsSection>
      <PromptSuggestionsSettings />
      <PromptPolishSettings />
      <DecisionsSettingsSection />
    </SettingsPageContainer>
  );
}
