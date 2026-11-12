import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { SIDEBAR_COLORS, isSidebarColor } from "../../sidebarColors";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "../ui/menu";

export function SidebarColorMarker({
  color,
  variant = "dot",
}: {
  color?: string | null | undefined;
  variant?: "dot" | "swatch";
}) {
  if (!color && variant === "dot") return null;
  return (
    <span
      aria-hidden="true"
      data-sidebar-color={color}
      className={cn(
        "inline-block shrink-0 rounded-full border",
        variant === "swatch" ? "size-3 border-border" : "size-2 border-current/30",
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

function SidebarColorChoices({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const [custom, setCustom] = useState(value ?? "#629bd7");
  const valid = isSidebarColor(custom);
  const customSelected =
    value !== null && !SIDEBAR_COLORS.some((color) => color.value === value.toLowerCase());
  const apply = () => {
    if (valid) onChange(custom.toLowerCase());
  };
  return (
    <>
      <MenuRadioGroup
        value={value?.toLowerCase() ?? "default"}
        onValueChange={(color) => {
          if (color === "default" || isSidebarColor(color))
            onChange(color === "default" ? null : color);
        }}
      >
        <MenuGroupLabel>Sidebar color</MenuGroupLabel>
        {[{ name: "Default", value: "default" }, ...SIDEBAR_COLORS].map((color) => (
          <MenuRadioItem
            variant="rounded"
            closeOnClick={false}
            key={color.value}
            value={color.value}
          >
            <span className="flex min-w-0 items-center gap-2">
              <SidebarColorMarker
                variant="swatch"
                color={color.value === "default" ? null : color.value}
              />
              <span className="min-w-0 flex-1 truncate">{color.name}</span>
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel>
          <span className="flex items-center gap-2">
            <span className="flex-1">Custom color</span>
            {customSelected ? (
              <>
                <CheckIcon aria-hidden className="size-3.5" />
                <span className="sr-only">Current color</span>
              </>
            ) : null}
          </span>
        </MenuGroupLabel>
        <div
          className="flex items-center gap-2 px-2 py-1"
          onKeyDown={(event) => {
            if (event.key !== "Escape") event.stopPropagation();
          }}
        >
          <SidebarColorMarker variant="swatch" color={valid ? custom : null} />
          <Input
            aria-label="Custom sidebar color"
            value={custom}
            aria-invalid={!valid || undefined}
            spellCheck={false}
            font="mono"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="#629bd7"
            size="sm"
          />
          <Button size="sm" variant="outline" disabled={!valid} onClick={apply}>
            Apply
          </Button>
        </div>
      </MenuGroup>
    </>
  );
}
export function SidebarColorPicker(props: {
  value: string | null;
  onChange: (color: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" disabled={props.disabled} />}>
        <SidebarColorMarker variant="swatch" color={props.value} />
        Sidebar color
      </MenuTrigger>
      <MenuPopup align="end">
        <SidebarColorChoices {...props} />
      </MenuPopup>
    </Menu>
  );
}
export function SidebarColorSubmenu(props: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  return (
    <MenuSub>
      <MenuSubTrigger>Sidebar color</MenuSubTrigger>
      <MenuSubPopup>
        <SidebarColorChoices {...props} />
      </MenuSubPopup>
    </MenuSub>
  );
}
