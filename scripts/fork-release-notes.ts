// @effect-diagnostics nodeBuiltinImport:off -- Release tooling reads local git history and writes the release body.
import * as NodeChildProcess from "node:child_process";

interface Commit {
  readonly sha: string;
  readonly subject: string;
}

export function formatForkReleaseNotes(input: {
  readonly repository: string;
  readonly version: string;
  readonly sha: string;
  readonly previousTag: string | undefined;
  readonly commits: ReadonlyArray<Commit>;
  readonly upstreamCommits: ReadonlySet<string>;
}): string {
  const fork = input.commits.filter((commit) => !input.upstreamCommits.has(commit.sha));
  const upstream = input.commits.filter((commit) => input.upstreamCommits.has(commit.sha));
  const notable = upstream.filter((commit) =>
    /^(feat|fix)(?:\([^)]*\))?!?:\s/i.test(commit.subject),
  );
  const bullets = (commits: ReadonlyArray<Commit>) =>
    commits
      .slice(0, 4)
      .map((commit) => `- ${commit.subject.replace(/[\r\n<>]/g, " ").slice(0, 220)}`);
  const base = `https://github.com/${input.repository}`;
  const compare =
    input.previousTag === undefined
      ? `${base}/commit/${input.sha}`
      : `${base}/compare/${encodeURIComponent(input.previousTag)}...${input.sha}`;
  return [
    "## In this update",
    "",
    `v${input.version} · ${fork.length} fork commits · ${upstream.length} upstream commits`,
    ...(input.previousTag === undefined
      ? ["First fork release; earlier upstream history is the baseline."]
      : []),
    "",
    "### Fork changes",
    ...(fork.length > 0 ? bullets(fork) : ["- No fork-specific changes."]),
    "",
    `### From upstream (${upstream.length} commits)`,
    ...(notable.length > 0
      ? bullets(notable)
      : [
          upstream.length > 0
            ? "- Upstream maintenance and improvements."
            : "- No new upstream commits.",
        ]),
    "",
    "<details><summary>Full changelog</summary>",
    "",
    `[Compare all changes](${compare})`,
    ...(fork.length > 4 || notable.length > 4
      ? [
          "The highlights above are capped at four per section; the comparison contains every change.",
        ]
      : []),
    "",
    "</details>",
    "",
    "## Install and update",
    "",
    `Fork build of \`${input.sha.slice(0, 12)}\`.`,
    `Servers: set \`T3CODE_RELEASE_BASE_URL=${base}/releases/download\` and update to \`${input.version}\` once; subsequent updates install while idle.`,
    "The Mac build is ad-hoc signed: approve the first install in macOS. It downloads subsequent updates and installs on quit. Settings and conversations stay in place.",
    "",
  ].join("\n");
}

if (import.meta.main) {
  const repository = process.env.GITHUB_REPOSITORY;
  const version = process.env.VERSION;
  const sha = process.env.SHA;
  const previousTag = process.env.PREVIOUS_TAG || undefined;
  const upstreamRef = process.env.UPSTREAM_REF ?? "refs/remotes/upstream/main";
  if (!repository || !version || !sha)
    throw new Error("GITHUB_REPOSITORY, VERSION, and SHA are required.");
  const git = (args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", [...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  const upstreamCommits = new Set(git(["rev-list", upstreamRef]).trim().split("\n"));
  const range = `${previousTag ?? upstreamRef}..${sha}`;
  const commits = git(["log", "--no-merges", "--format=%H%x00%s", range, "--"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commitSha = "", subject = ""] = line.split("\0");
      return { sha: commitSha, subject };
    });
  process.stdout.write(
    formatForkReleaseNotes({ repository, version, sha, previousTag, commits, upstreamCommits }),
  );
}
