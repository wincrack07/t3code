import { expect, it } from "vite-plus/test";
import { formatForkReleaseNotes } from "./fork-release-notes.ts";

it("separates fork commits from a large upstream sync and caps its notable changes", () => {
  const upstream = Array.from({ length: 250 }, (_, index) => ({
    sha: `upstream-${index}`,
    subject: index < 7 ? `fix(web): repair ${index}` : `chore: maintenance ${index}`,
  }));
  const notes = formatForkReleaseNotes({
    repository: "owner/fork",
    version: "1.2.3",
    sha: "new-sha",
    previousTag: "v1.2.2",
    commits: [{ sha: "fork", subject: "feat: automatic updates" }, ...upstream],
    upstreamCommits: new Set(upstream.map((commit) => commit.sha)),
  });
  expect(notes).toContain("1 fork commits · 250 upstream commits");
  expect(notes).toContain("### Fork changes\n- feat: automatic updates");
  expect(notes).toContain("fix(web): repair 3");
  expect(notes).not.toContain("fix(web): repair 4");
  expect(notes).not.toContain("chore: maintenance");
  expect(notes).toContain("https://github.com/owner/fork/compare/v1.2.2...new-sha");
  expect(notes.indexOf("## Install and update")).toBeGreaterThan(notes.indexOf("</details>"));
});

it("handles the first release and a release with no changes", () => {
  const notes = formatForkReleaseNotes({
    repository: "owner/fork",
    version: "1.0.0",
    sha: "first",
    previousTag: undefined,
    commits: [],
    upstreamCommits: new Set(),
  });
  expect(notes).toContain("First fork release");
  expect(notes).toContain("No fork-specific changes.");
  expect(notes).toContain("No new upstream commits.");
  expect(notes).toContain("https://github.com/owner/fork/commit/first");
});
