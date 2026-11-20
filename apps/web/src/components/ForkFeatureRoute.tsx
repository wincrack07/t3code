import type { ForkFeatureId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { T } from "gt-react";
import type { ReactNode } from "react";

import { useForkFeature } from "../state/forkFeatures";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";

/** A fork page that stays reachable by link, but says so when its feature is switched off. */
export function ForkFeatureRoute(props: { feature: ForkFeatureId; children: ReactNode }) {
  if (useForkFeature(props.feature)) return props.children;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>
            <T>This feature is turned off</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>Turn it back on in Settings, under Sally's Version → Features.</T>
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link to="/settings/fork/features" />}>
          <T>Open Features</T>
        </Button>
      </Empty>
    </SidebarInset>
  );
}
