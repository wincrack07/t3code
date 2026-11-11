import type { BrowserExtension, BrowserExtensionInstallInput } from "@t3tools/contracts";
import { FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const previewBridge = () => window.desktopBridge?.preview;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

export function BrowserExtensionsSetting({ disabled }: { readonly disabled: boolean }) {
  const [extensions, setExtensions] = useState<ReadonlyArray<BrowserExtension> | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    (previewBridge()?.listBrowserExtensions() ?? Promise.resolve([])).then(setExtensions, () =>
      setExtensions([]),
    );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reads the desktop's installed extensions, which live outside React.
  useEffect(() => {
    if (disabled) return;
    void (previewBridge()?.listBrowserExtensions() ?? Promise.resolve([])).then(setExtensions, () =>
      setExtensions([]),
    );
  }, [disabled]);

  const install = async (input: BrowserExtensionInstallInput) => {
    const bridge = previewBridge();
    if (!bridge) return;
    setBusy(true);
    const result = await bridge
      .installBrowserExtension(input)
      .catch((error: unknown) => ({ status: "failed", message: errorMessage(error) }) as const);
    setBusy(false);
    if (result.status === "failed") {
      toastManager.add({
        type: "error",
        title: "Extension not added",
        description: result.message,
      });
    } else if (result.status === "installed") {
      setReference("");
      toastManager.add({
        type: "success",
        title: `Added ${result.extension.name}`,
        description: "Reload open pages for it to take effect.",
      });
    }
    await refresh();
  };

  const update = async (run: () => Promise<void> | undefined) => {
    await Promise.resolve(run()).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Extension not updated",
        description: errorMessage(error),
      });
    });
    await refresh();
  };

  const controlsDisabled = disabled || busy;

  return (
    <>
      <SettingsRow
        {...searchableSetting("browser-extension-list")}
        description="Chrome extensions for the built-in browser, in every saved profile. T3 Code asks you to approve each one with its permissions."
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={controlsDisabled}
            onClick={() => void install({ kind: "unpacked" })}
          >
            <FolderOpen />
            Load unpacked
          </Button>
        }
      >
        {extensions !== null && extensions.length > 0 ? (
          <div className="mt-2 mb-2 overflow-hidden rounded-lg border border-border/60">
            {extensions.map((extension, index) => (
              <div
                key={extension.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2",
                  index > 0 && "border-t border-border/60",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-foreground">{extension.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {extension.loadError ??
                      `${extension.version} · ${extension.source === "webStore" ? "Chrome Web Store" : "Unpacked"}`}
                  </span>
                </span>
                <Switch
                  disabled={disabled}
                  checked={extension.enabled}
                  aria-label={`Enable ${extension.name}`}
                  onCheckedChange={(checked) =>
                    void update(() =>
                      previewBridge()?.setBrowserExtensionEnabled(extension.id, Boolean(checked)),
                    )
                  }
                />
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  disabled={disabled}
                  aria-label={`Remove ${extension.name}`}
                  onClick={() =>
                    void update(() => previewBridge()?.removeBrowserExtension(extension.id))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </SettingsRow>
      <SettingsRow
        {...searchableSetting("browser-extension-web-store")}
        description="Paste a Chrome Web Store link or extension ID. Extensions that rely on a desktop app, such as 1Password's app unlock, cannot connect to it here."
        control={
          <form
            className="flex w-full gap-2 sm:w-80"
            onSubmit={(event) => {
              event.preventDefault();
              if (reference.trim() !== "") void install({ kind: "webStore", reference });
            }}
          >
            <Input
              nativeInput
              size="sm"
              aria-label="Chrome Web Store link or ID"
              placeholder="chromewebstore.google.com/detail/…"
              autoCapitalize="none"
              spellCheck={false}
              disabled={controlsDisabled}
              value={reference}
              onChange={(event) => setReference(event.currentTarget.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={controlsDisabled || reference.trim() === ""}
            >
              Add
            </Button>
          </form>
        }
      />
    </>
  );
}
