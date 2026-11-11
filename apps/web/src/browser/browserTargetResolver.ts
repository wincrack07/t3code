import type { EnvironmentId } from "@t3tools/contracts";
import {
  environmentPortTargetFromUrl,
  environmentPortTargetUrl,
  normalizePreviewUrl,
} from "@t3tools/shared/preview";

import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { isElectron } from "~/env";
import { readPreparedConnection } from "~/state/session";

export { normalizeHostname, isLocalLoopbackHost } from "@t3tools/shared/hostClassification";

export function requiresEnvironmentBrowser(environmentId: EnvironmentId, rawUrl: string): boolean {
  if (!environmentPortTargetFromUrl(rawUrl)) return false;
  const target = readPreparedConnection(environmentId)?.target;
  return !(
    isElectron &&
    target &&
    (target._tag === "PrimaryConnectionTarget" || isDesktopLocalConnectionTarget(target))
  );
}

export function resolveDiscoveredServerUrl(_environmentId: EnvironmentId, rawUrl: string): string {
  try {
    const target = environmentPortTargetFromUrl(rawUrl);
    return target ? environmentPortTargetUrl(target) : normalizePreviewUrl(rawUrl);
  } catch {
    return rawUrl;
  }
}
