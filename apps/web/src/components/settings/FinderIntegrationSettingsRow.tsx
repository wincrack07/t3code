import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";

const reportFailure = (error: unknown) =>
  toastManager.add({
    type: "error",
    title: "Finder integration failed",
    description: error instanceof Error ? error.message : String(error),
  });

export function FinderIntegrationSettingsRow() {
  const bridge = window.desktopBridge?.finderIntegration;
  const [state, setState] = useState<{ supported: boolean; installed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the installed workflow from the desktop filesystem when Settings mounts
  useEffect(() => {
    if (bridge) void bridge.getState().then(setState).catch(reportFailure);
  }, [bridge]);
  if (!bridge || !state?.supported) return null;
  return (
    <SettingsRow
      id="finder-integration"
      title="Finder integration"
      status={state.installed ? "Installed" : "Not installed"}
      description="Adds Send to T3 Code for files and folders. You may need to enable it in System Settings → Keyboard → Keyboard Shortcuts → Services."
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void bridge
              .setInstalled(!state.installed)
              .then(setState)
              .catch(reportFailure)
              .finally(() => setBusy(false));
          }}
        >
          {state.installed ? "Remove" : "Install"}
        </Button>
      }
    />
  );
}
