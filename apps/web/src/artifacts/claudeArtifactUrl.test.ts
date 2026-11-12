import { describe, expect, it } from "vite-plus/test";

import { parseClaudeArtifactUrl } from "./claudeArtifactUrl";

const ID = "0f8b6c2e-1d2a-4c3b-9e4f-5a6b7c8d9e0f";

describe("parseClaudeArtifactUrl", () => {
  it("reads every claude.ai artifact link shape", () => {
    for (const url of [
      `https://claude.ai/artifact/${ID}`,
      `https://claude.ai/code/artifact/${ID}`,
      `https://claude.ai/public/artifacts/${ID}`,
      `https://claude.ai/public/artifacts/${ID}/?utm=x#top`,
    ]) {
      expect(parseClaudeArtifactUrl(url)?.id).toBe(ID);
    }
  });

  it("rejects look-alike hosts, other schemes and other claude.ai paths", () => {
    for (const url of [
      `https://claude.ai.evil.com/artifact/${ID}`,
      `https://evilclaude.ai/artifact/${ID}`,
      `https://www.claude.ai/artifact/${ID}`,
      `https://api.claude.ai/artifact/${ID}`,
      `https://claude.ai@evil.com/artifact/${ID}`,
      `https://user@claude.ai/artifact/${ID}`,
      `https://claude.ai:8443/artifact/${ID}`,
      `http://claude.ai/artifact/${ID}`,
      `https://claude.ai/chat/${ID}`,
      `https://claude.ai/artifact/`,
      `https://claude.ai/artifact/${ID}/edit`,
      `https://claude.ai/x/artifact/${ID}`,
      `https://claude.com/artifact/${ID}`,
      "not a url",
    ]) {
      expect(parseClaudeArtifactUrl(url)).toBeNull();
    }
  });
});
