import { SlidersHorizontalIcon } from "lucide-react";
import { useClientSettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from "../ui/menu";

export function SidebarDisplayMenu() {
  const density = useClientSettings((settings) => settings.sidebarDensity);
  const grouping = useClientSettings((settings) => settings.sidebarThreadGrouping);
  const update = useUpdatePrimarySettings();
  return (
    <Menu>
      <MenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Sidebar display" />}>
        <SlidersHorizontalIcon className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroupLabel>Thread density</MenuGroupLabel>
        <MenuRadioGroup
          value={density}
          onValueChange={(value) => {
            if (value === "theme" || value === "compact" || value === "comfortable")
              update({ sidebarDensity: value });
          }}
        >
          <MenuRadioItem value="theme">Theme default</MenuRadioItem>
          <MenuRadioItem value="compact">Compact</MenuRadioItem>
          <MenuRadioItem value="comfortable">Comfortable</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuGroupLabel>Thread grouping</MenuGroupLabel>
        <MenuRadioGroup
          value={grouping}
          onValueChange={(value) => {
            if (value === "theme" || value === "project" || value === "global")
              update({ sidebarThreadGrouping: value });
          }}
        >
          <MenuRadioItem value="theme">Theme default</MenuRadioItem>
          <MenuRadioItem value="project">All threads by project</MenuRadioItem>
          <MenuRadioItem value="global">Global settled section</MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
