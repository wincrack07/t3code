// claude.ai serves artifacts at these paths; anything else on claude.ai is an ordinary link.
const ARTIFACT_PATH = /^\/(?:artifact|code\/artifact|public\/artifacts)\/([A-Za-z0-9_-]+)\/?$/;

export interface ClaudeArtifactLink {
  /** Stable across the link shapes and query strings that point at one artifact. */
  readonly id: string;
  readonly url: string;
}

export function parseClaudeArtifactUrl(url: string): ClaudeArtifactLink | null {
  const parsed = URL.parse(url);
  if (
    parsed === null ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "claude.ai" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return null;
  }
  const id = ARTIFACT_PATH.exec(parsed.pathname)?.[1];
  return id === undefined ? null : { id, url: parsed.href };
}

export const isClaudeArtifactUrl = (url: string): boolean => parseClaudeArtifactUrl(url) !== null;
