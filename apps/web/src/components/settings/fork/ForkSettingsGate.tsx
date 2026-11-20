import { Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import type { ReactNode } from "react";

import { usePrimaryForkFeatureSwitches } from "../../../state/forkFeatures";
import { Button } from "../../ui/button";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settingsLayout";
import { forkSettingsPathVisible } from "./forkSettings";
import { isForkFeatureOn } from "@t3tools/contracts";

/** A fork settings page reached by link while its features are switched off says so. */
export function ForkSettingsGate(props: { path: string; children: ReactNode }) {
  const gt = useGT();
  const switches = usePrimaryForkFeatureSwitches();
  if (forkSettingsPathVisible(props.path, (feature) => isForkFeatureOn(switches, feature)))
    return props.children;
  return (
    <SettingsPageContainer>
      <SettingsSection title={gt("Turned off")}>
        <SettingsRow
          title={gt("This feature is turned off")}
          description={gt("Turn it back on in Settings, under Sally's Version → Features.")}
          control={
            <Button size="sm" variant="outline" render={<Link to="/settings/fork/features" />}>
              <T>Open Features</T>
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
