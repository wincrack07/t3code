import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildNewThreadLink,
  parseNewThreadLink,
  parseNewTaskLink,
  parseThreadLinkPrompt,
  promptLinkAppPath,
  promptLinkDeepLink,
  sanitizeLinkedPrompt,
  withoutPromptLinkParams,
} from "./promptLinks.ts";
import { hostedThreadLink } from "./threadLinks.ts";

describe("sanitizeLinkedPrompt", () => {
  it("removes characters a reader cannot see and counts them", () => {
    const tagged = "rate me" + String.fromCodePoint(0xe0041, 0xe0042);
    expect(sanitizeLinkedPrompt(`a\u200Bb\u202Ec\uFEFF${tagged}`)).toEqual({
      text: "abcrate me",
      hiddenCharacters: 5,
    });
    expect(sanitizeLinkedPrompt("a\u2028b\u2029c")).toEqual({
      text: "a\nb\nc",
      hiddenCharacters: 0,
    });
  });

  it("keeps emoji sequences intact", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const heart = "\u2764\uFE0F";
    expect(sanitizeLinkedPrompt(`${family} ${heart}`)).toEqual({
      text: `${family} ${heart}`,
      hiddenCharacters: 0,
    });
    expect(sanitizeLinkedPrompt("a\u200Db").hiddenCharacters).toBe(1);
    expect(sanitizeLinkedPrompt("\u{1F468}\u200D").hiddenCharacters).toBe(1);
    expect(sanitizeLinkedPrompt("\u{20000}\u200D\u{20001}").hiddenCharacters).toBe(1);
  });
});

describe("parseNewThreadLink", () => {
  it("reads a shared prompt with its optional repository and model", () => {
    const result = parseNewThreadLink(
      "?prompt=Rate+me&repo=https://github.com/pingdotgg/t3code.git&provider=Codex&model=gpt-5",
    );
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "new",
        prompt: { text: "Rate me", hiddenCharacters: 0 },
        repository: { owner: "pingdotgg", name: "t3code" },
        provider: "codex",
        model: "gpt-5",
      },
    });
  });

  it("reads a pull request link, whose prompt is optional", () => {
    for (const pr of [
      "pingdotgg/t3code/42",
      "pingdotgg/t3code%2342",
      "https://github.com/pingdotgg/t3code/pull/42/files",
    ]) {
      expect(parseNewThreadLink(`?pr=${pr}`)).toEqual({
        ok: true,
        value: {
          kind: "pull-request",
          pullRequest: { owner: "pingdotgg", name: "t3code", number: 42 },
          prompt: null,
        },
      });
    }
  });

  it("refuses links it cannot open safely", () => {
    for (const query of [
      "?prompt=123",
      "?prompt=a%2Bb+c",
      "?prompt=%E0%A4%A",
      "?prompt=one&prompt=two",
      "?prompt=%E2%80%8Bvisible",
      "?prompt=line%0D%0Atwo",
      "?repo=a/b",
      "?prompt=%E2%80%8B",
      `?prompt=${"x".repeat(8001)}`,
      "?prompt=x&repo=../etc",
    ]) {
      const thread = parseNewThreadLink(query);
      const task = parseNewTaskLink(query);
      expect(task.ok).toBe(thread.ok);
      if (thread.ok && thread.value.kind === "new" && task.ok)
        expect(task.value.prompt).toEqual(thread.value.prompt);
    }
    expect(parseNewTaskLink("?prompt=123&title=42&repo=acme/app")).toEqual({
      ok: true,
      value: {
        prompt: { text: "123", hiddenCharacters: 0 },
        title: "42",
        repository: { owner: "acme", name: "app" },
      },
    });
    expect(parseNewTaskLink(`?prompt=x&title=${"x".repeat(161)}`).ok).toBe(false);
    expect(parseNewTaskLink("?prompt=x&title=%E2%80%8BTitle")).toMatchObject({
      ok: true,
      value: { title: "Title", prompt: { hiddenCharacters: 1 } },
    });
    expect(parseNewThreadLink("?repo=a/b").ok).toBe(false);
    expect(parseNewThreadLink("?prompt=%E2%80%8B").ok).toBe(false);
    expect(parseThreadLinkPrompt("?prompt=%E2%80%8B").ok).toBe(false);
    expect(parseNewThreadLink("?prompt=x&repo=../etc").ok).toBe(false);
    expect(parseNewThreadLink(`?prompt=${"x".repeat(8_001)}`).ok).toBe(false);
  });
});

describe("thread links", () => {
  it("reads the prompt and leaves other parameters in place", () => {
    expect(parseThreadLinkPrompt("?prompt=Fix+it")).toEqual({
      ok: true,
      value: { text: "Fix it", hiddenCharacters: 0 },
    });
    expect(parseThreadLinkPrompt("?panel=diff")).toEqual({ ok: true, value: null });
    expect(withoutPromptLinkParams("?prompt=x&panel=diff")).toBe("?panel=diff");
  });
});

describe("link round trips", () => {
  it("builds a link that parses back to the same prompt", () => {
    const link = buildNewThreadLink({
      prompt: "Swear count & rating?",
      repository: { owner: "pingdotgg", name: "t3code" },
      provider: "claudeAgent",
      model: "opus",
    });
    const path = promptLinkAppPath(link);
    expect(path).toBe(new URL(link).pathname + new URL(link).search);
    const parsed = parseNewThreadLink(new URL(link).search);
    expect(parsed.ok && parsed.value.kind === "new" && parsed.value.prompt.text).toBe(
      "Swear count & rating?",
    );
  });

  it("opens a copied thread link in the app at that thread", () => {
    const link = hostedThreadLink({
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("mcp:1"),
    });
    const path = promptLinkAppPath(link);
    expect(path).toBe("/env-1/mcp%3A1");
    const deepLink = promptLinkDeepLink(path!);
    expect(deepLink).toBe("t3code://threads/env-1/mcp%3A1");
    expect(promptLinkAppPath(deepLink)).toBe(path);
  });

  it("maps app scheme and hosted links to in-app paths, and nothing else", () => {
    expect(promptLinkAppPath("t3code://new?prompt=hi")).toBe("/new?prompt=hi");
    for (const link of [
      "t3code://tasks/new?prompt=123&title=42",
      "t3code-dev://tasks/new?prompt=123&title=42",
      "https://app.t3.codes/tasks/new?prompt=123&title=42",
    ])
      expect(promptLinkAppPath(link)).toBe("/tasks/new?prompt=123&title=42");
    expect(promptLinkDeepLink("/tasks/new?prompt=123&title=42")).toBe(
      "t3code://tasks/new?prompt=123&title=42",
    );
    expect(promptLinkAppPath("https://evil.test/tasks/new?prompt=x")).toBeNull();
    expect(promptLinkAppPath("t3code://tasks/other?prompt=x")).toBeNull();

    expect(promptLinkAppPath("t3code-dev://threads/env-1/thread-1")).toBe("/env-1/thread-1");
    expect(promptLinkAppPath("https://app.t3.codes/env-1/thread-1?prompt=go")).toBe(
      "/env-1/thread-1?prompt=go",
    );
    expect(promptLinkAppPath("https://app.t3.codes/threads/env-1/thread-1")).toBe(
      "/env-1/thread-1",
    );
    expect(promptLinkAppPath("https://app.t3.codes/threads/env-1/thread-1?prompt=go")).toBe(
      "/env-1/thread-1?prompt=go",
    );
    // The web app's own thread route, reloaded, is no link.
    expect(promptLinkAppPath("https://app.t3.codes/env-1/thread-1")).toBeNull();
    expect(promptLinkAppPath("https://app.t3.codes/threads/env-1")).toBeNull();
    expect(promptLinkAppPath("https://app.t3.codes/settings/general")).toBeNull();
    expect(promptLinkAppPath("https://evil.test/new?prompt=hi")).toBeNull();
    expect(promptLinkAppPath("t3code://app/index.html")).toBeNull();
  });
});
