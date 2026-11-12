import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";

import { parseClaudeArtifactUrl } from "./claudeArtifactUrl";

// A private artifact redirects to claude.ai's sign-in page, so the tab's URL stops naming it.
const openedArtifactByTab = new Map<string, string>();

const tabKey = (ref: ScopedThreadRef, tabId: string) => `${scopedThreadKey(ref)}\0${tabId}`;

export function rememberArtifactTab(ref: ScopedThreadRef, tabId: string, artifactId: string) {
  openedArtifactByTab.set(tabKey(ref, tabId), artifactId);
}

/** The thread's tab already showing this artifact in this browser profile, if any. */
export function findArtifactTab(
  ref: ScopedThreadRef,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  artifactId: string,
  profileId: string | undefined,
): string | null {
  for (const snapshot of Object.values(sessions)) {
    if (profileId !== undefined && (snapshot.profileId ?? "default") !== profileId) continue;
    const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
    const showing =
      (url === null ? null : parseClaudeArtifactUrl(url)?.id) ??
      openedArtifactByTab.get(tabKey(ref, snapshot.tabId));
    if (showing === artifactId) return snapshot.tabId;
  }
  return null;
}
