import { useState } from "react";
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
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "../ui/menu";

export function SidebarColorMarker({ color }: { color?: string | null | undefined }) {
  return color ? (
    <span
      aria-hidden="true"
      data-sidebar-color={color}
      className="inline-block size-2 shrink-0 rounded-full border border-current/30"
      style={{ backgroundColor: color }}
    />
  ) : null;
}

function SidebarColorChoices({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const [custom, setCustom] = useState(value ?? "#629bd7");
  return (
    <>
      <MenuRadioGroup
        value={value ?? "default"}
        onValueChange={(color) => {
          if (color === "default" || isSidebarColor(color))
            onChange(color === "default" ? null : color);
        }}
      >
        <MenuGroupLabel>Sidebar colour</MenuGroupLabel>
        <MenuRadioItem value="default">Default</MenuRadioItem>
        {SIDEBAR_COLORS.map((color) => (
          <MenuRadioItem closeOnClick={false} key={color.value} value={color.value}>
            <SidebarColorMarker color={color.value} />
            {color.name}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel>Custom colour</MenuGroupLabel>
        <div className="flex items-center gap-2 p-2" onKeyDown={(event) => event.stopPropagation()}>
          <Input
            aria-label="Custom sidebar colour"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="#629bd7"
            size="sm"
          />
          <Button
            size="xs"
            variant="outline"
            disabled={!isSidebarColor(custom)}
            onClick={() => onChange(custom)}
          >
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
        <SidebarColorMarker color={props.value} />
        Sidebar colour
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
      <MenuSubTrigger>Sidebar colour</MenuSubTrigger>
      <MenuSubPopup>
        <SidebarColorChoices {...props} />
      </MenuSubPopup>
    </MenuSub>
  );
}
