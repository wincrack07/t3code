import type { BrowserExtension, BrowserExtensionInstallInput } from "@t3tools/contracts";
import { msg, T, useGT } from "gt-react";
import { FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { m } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const previewBridge = () => window.desktopBridge?.preview;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : m(msg("Something went wrong."));

export function BrowserExtensionsSetting({ disabled }: { readonly disabled: boolean }) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
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
        title: gt("Extension not added"),
        description: result.message,
      });
    } else if (result.status === "installed") {
      setReference("");
      toastManager.add({
        type: "success",
        title: gt("Added {name}", { name: result.extension.name }),
        description: gt("Reload open pages for it to take effect."),
      });
    }
    await refresh();
  };

  const update = async (run: () => Promise<void> | undefined) => {
    await Promise.resolve(run()).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: gt("Extension not updated"),
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
        description={gt(
          "Chrome extensions for the built-in browser, in every saved profile. T3 Code asks you to approve each one with its permissions.",
        )}
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={controlsDisabled}
            onClick={() => void install({ kind: "unpacked" })}
          >
            <FolderOpen />
            <T>Load unpacked</T>
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
                      `${extension.version} · ${extension.source === "webStore" ? "Chrome Web Store" : gt("Unpacked", { $context: "extension loaded from a local folder" })}`}
                  </span>
                </span>
                <Switch
                  disabled={disabled}
                  checked={extension.enabled}
                  aria-label={gt("Enable {name}", { name: extension.name })}
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
                  aria-label={gt("Remove {name}", { name: extension.name })}
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
        description={gt(
          "Paste a Chrome Web Store link or extension ID. Extensions that rely on a desktop app, such as 1Password's app unlock, cannot connect to it here.",
        )}
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
              aria-label={gt("Chrome Web Store link or ID")}
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
              <T context="verb, adds an extension">Add</T>
            </Button>
          </form>
        }
      />
    </>
  );
}
