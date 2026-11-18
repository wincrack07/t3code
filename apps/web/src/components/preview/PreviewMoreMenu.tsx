import type { BrowserExtension, DesktopPreviewColorScheme } from "@t3tools/contracts";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { Minus, MoreVertical, Plus as PlusIcon, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuShortcut,
  MenuRadioGroup,
  MenuRadioItem,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

const COLOR_SCHEME_OPTIONS: ReadonlyArray<{
  value: DesktopPreviewColorScheme;
  label: string;
}> = [
  { value: "system", label: msg("System", { $context: "color scheme" }) },
  { value: "light", label: msg("Light", { $context: "color scheme" }) },
  { value: "dark", label: msg("Dark", { $context: "color scheme" }) },
];

export interface PreviewMoreMenuActions {
  readonly hardReload: () => void;
  readonly setColorScheme: (colorScheme: DesktopPreviewColorScheme) => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly resetZoom: () => void;
  readonly clearCookies: () => void;
  readonly clearCache: () => void;
  readonly openDevTools?: () => void;
  readonly toggleNativePictureInPicture?: () => void;
  readonly find?: () => void;
  /** Desktop tabs only: installed extensions, read each time the menu opens. */
  readonly listExtensions?: () => Promise<ReadonlyArray<BrowserExtension>>;
  readonly openExtensionPopup?: (extensionId: string) => void;
}

interface Props {
  enabled: boolean;
  actions: PreviewMoreMenuActions;
  zoomFactor: number;
  colorScheme: DesktopPreviewColorScheme;
  deviceToolbarVisible: boolean;
  onToggleDeviceToolbar: () => void;
  nativePictureInPicture: boolean;
  profileName: string | undefined;
  findShortcutLabel?: string | null;
  move?: { readonly label: string; readonly onMove: () => void };
}

const MenuTriggerButton = () => {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                aria-label={gt("Preview menu")}
              />
            }
          />
        }
      >
        <MoreVertical />
      </TooltipTrigger>
      <TooltipPopup>
        <T context="more actions menu">More</T>
      </TooltipPopup>
    </Tooltip>
  );
};

export function PreviewMoreMenu({
  enabled,
  actions,
  zoomFactor,
  colorScheme,
  deviceToolbarVisible,
  onToggleDeviceToolbar,
  nativePictureInPicture,
  profileName,
  findShortcutLabel,
  move,
}: Props) {
  const gt = useGT();
  const m = useMessages();
  const zoomLabel = `${Math.round(zoomFactor * 100)}%`;
  const disabled = !enabled;
  const [extensions, setExtensions] = useState<ReadonlyArray<BrowserExtension>>([]);
  const popupExtensions = extensions.filter((extension) => extension.enabled && extension.hasPopup);
  const { listExtensions, openExtensionPopup } = actions;
  return (
    <Menu
      onOpenChange={(open) => {
        if (open && listExtensions) {
          void listExtensions().then(setExtensions, () => setExtensions([]));
        }
      }}
    >
      <MenuTriggerButton />
      <MenuPopup align="end" sideOffset={6}>
        {actions.find ? (
          <MenuItem onClick={actions.find} disabled={disabled}>
            <T>Find on page</T>
            {findShortcutLabel ? <MenuShortcut>{findShortcutLabel}</MenuShortcut> : null}
          </MenuItem>
        ) : null}
        <MenuItem onClick={actions.hardReload} disabled={disabled}>
          <T>Hard reload</T>
        </MenuItem>
        {actions.openDevTools ? (
          <MenuItem onClick={actions.openDevTools} disabled={disabled}>
            <T>Open DevTools</T>
          </MenuItem>
        ) : null}
        {actions.toggleNativePictureInPicture ? (
          <MenuItem onClick={actions.toggleNativePictureInPicture} disabled={disabled}>
            {nativePictureInPicture
              ? gt("Close separate preview window")
              : gt("Open separate preview window")}
          </MenuItem>
        ) : null}
        {move ? <MenuItem onClick={move.onMove}>{move.label}</MenuItem> : null}
        <MenuItem onClick={onToggleDeviceToolbar} disabled={disabled}>
          {deviceToolbarVisible ? gt("Hide device toolbar") : gt("Show device toolbar")}
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger disabled={disabled}>
            <T>Appearance</T>
          </MenuSubTrigger>
          <MenuSubPopup>
            <MenuRadioGroup
              value={colorScheme}
              onValueChange={(value) => actions.setColorScheme(value as DesktopPreviewColorScheme)}
            >
              {COLOR_SCHEME_OPTIONS.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  {m(option.label)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuItem
          closeOnClick={false}
          onClick={(event: React.MouseEvent) => event.preventDefault()}
          className="justify-between"
          disabled={disabled}
        >
          <span>
            <T>Zoom</T>
          </span>
          <span className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-xs"
              type="button"
              onClick={actions.zoomOut}
              aria-label={gt("Zoom out")}
              disabled={disabled}
            >
              <Minus />
            </Button>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
              {zoomLabel}
            </span>
            <Button
              variant="outline"
              size="icon-xs"
              type="button"
              onClick={actions.zoomIn}
              aria-label={gt("Zoom in")}
              disabled={disabled}
            >
              <PlusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={actions.resetZoom}
              aria-label={gt("Reset zoom")}
              disabled={disabled}
            >
              <RotateCcw />
            </Button>
          </span>
        </MenuItem>
        <MenuSeparator />
        <MenuGroup>
          {profileName ? (
            <MenuGroupLabel className="max-w-64">
              <span className="block truncate">
                <T>
                  Profile: <Var>{profileName}</Var>
                </T>
              </span>
            </MenuGroupLabel>
          ) : null}
          <MenuItem onClick={actions.clearCookies}>
            <T>Clear cookies</T>
          </MenuItem>
          <MenuItem onClick={actions.clearCache}>
            <T>Clear cache</T>
          </MenuItem>
        </MenuGroup>
        {openExtensionPopup && popupExtensions.length > 0 ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>
                <T>Extensions</T>
              </MenuGroupLabel>
              {popupExtensions.map((extension) => (
                <MenuItem
                  key={extension.id}
                  disabled={disabled}
                  onClick={() => openExtensionPopup(extension.id)}
                >
                  <span className="max-w-56 truncate">{extension.name}</span>
                </MenuItem>
              ))}
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
