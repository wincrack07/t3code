import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The fence the review prompt asks the agent to end with. */
export const FINDINGS_FENCE = "t3-review";

const Severity = Schema.Literals(["high", "medium", "low"]);

const Finding = Schema.Struct({
  path: Schema.String,
  line: Schema.Int,
  startLine: Schema.optional(Schema.Int),
  side: Schema.optional(Schema.Literals(["RIGHT", "LEFT"])),
  severity: Severity,
  title: Schema.String,
  body: Schema.String,
  failureScenario: Schema.optional(Schema.String),
});
export type ReviewFinding = typeof Finding.Type;

const ReviewOutput = Schema.Struct({
  summary: Schema.String,
  findings: Schema.Array(Finding),
});
export type ReviewOutput = typeof ReviewOutput.Type;

const decodeOutput = Schema.decodeUnknownOption(Schema.fromJsonString(ReviewOutput));

/** The last `t3-review` block in the agent's answer, or none when it is missing or malformed. */
export function parseReviewOutput(text: string): Option.Option<ReviewOutput> {
  const blocks = [...text.matchAll(/```t3-review[^\n]*\n([\s\S]*?)\n?```/g)];
  const last = blocks.at(-1);
  return last === undefined ? Option.none() : decodeOutput(last[1]!.trim());
}

export interface DiffFile {
  readonly filename: string;
  /** GitHub omits it for binary and very large files. */
  readonly patch?: string | undefined;
}

interface CommentableLines {
  readonly right: ReadonlyMap<number, number>;
  readonly left: ReadonlyMap<number, number>;
}

/** Lines GitHub accepts a review comment on, each mapped to the hunk it is in. */
function commentableLines(patch: string): CommentableLines {
  const right = new Map<number, number>();
  const left = new Map<number, number>();
  let oldLine = 0;
  let newLine = 0;
  let hunk = -1;
  for (const line of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk++;
      continue;
    }
    if (hunk < 0 || line.startsWith("\\")) continue;
    if (line.startsWith("+")) right.set(newLine++, hunk);
    else if (line.startsWith("-")) left.set(oldLine++, hunk);
    else {
      right.set(newLine++, hunk);
      left.set(oldLine++, hunk);
    }
  }
  return { right, left };
}

export interface GitHubReviewComment {
  readonly path: string;
  readonly line: number;
  readonly side: "RIGHT" | "LEFT";
  readonly start_line?: number;
  readonly start_side?: "RIGHT" | "LEFT";
  readonly body: string;
}

const formatFindingBody = (finding: ReviewFinding) =>
  [
    `**${finding.severity.toUpperCase()}: ${finding.title.trim()}**`,
    finding.body.trim(),
    finding.failureScenario?.trim() ? `_Failure scenario:_ ${finding.failureScenario.trim()}` : "",
  ]
    .filter((part) => part !== "")
    .join("\n\n");

/**
 * Places each finding on the diff line it names. A finding on a line the diff does not show
 * (GitHub refuses those) is returned unplaced, for the review summary instead.
 */
export function mapFindingsToComments(
  findings: ReadonlyArray<ReviewFinding>,
  files: ReadonlyArray<DiffFile>,
): {
  readonly comments: ReadonlyArray<GitHubReviewComment>;
  readonly unplaced: ReadonlyArray<ReviewFinding>;
} {
  const byPath = new Map(
    files.flatMap((file) =>
      file.patch === undefined ? [] : [[file.filename, commentableLines(file.patch)] as const],
    ),
  );
  const comments: Array<GitHubReviewComment> = [];
  const unplaced: Array<ReviewFinding> = [];
  for (const finding of findings) {
    const path = finding.path.replace(/^\.?\//, "").replace(/^[ab]\//, "");
    const lines = byPath.get(path) ?? byPath.get(finding.path);
    const side = finding.side ?? "RIGHT";
    const sideLines = lines === undefined ? undefined : side === "RIGHT" ? lines.right : lines.left;
    const hunk = sideLines?.get(finding.line);
    if (sideLines === undefined || hunk === undefined) {
      unplaced.push(finding);
      continue;
    }
    const start = finding.startLine;
    const multiLine = start !== undefined && start < finding.line && sideLines.get(start) === hunk;
    comments.push({
      path,
      line: finding.line,
      side,
      ...(multiLine ? { start_line: start, start_side: side } : {}),
      body: formatFindingBody(finding),
    });
  }
  return { comments, unplaced };
}
