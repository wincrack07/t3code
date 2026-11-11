import { PrReviewError } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import { REVIEW_CHECKOUTS_DIRNAME } from "./checkouts.ts";
import { REVIEW_DIR } from "./reviewPrompt.ts";

// No prompts, no LFS downloads, no external diff or textconv drivers the checkout could name.
const GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  GIT_LFS_SKIP_SMUDGE: "1",
  LANGUAGE: "C",
} satisfies NodeJS.ProcessEnv;

const MAX_DIFF_BYTES = 16 * 1024 * 1024;

export interface PreparedCheckout {
  readonly path: string;
  readonly mergeBase: string;
}

/** The remote whose URL names `owner/name` on GitHub, else `origin`. */
function pickRemote(remotes: string, repository: string): string {
  const wanted = repository.toLowerCase();
  for (const line of remotes.split("\n")) {
    const [name, url] = line.trim().split(/\s+/);
    if (name === undefined || url === undefined) continue;
    const match = /github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(url);
    if (match && match[1]!.toLowerCase() === wanted) return name;
  }
  return "origin";
}

export const makeReviewCheckouts = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const git = (cwd: string, args: ReadonlyArray<string>, timeout: Duration.Input = "2 minutes") =>
    runner
      .run({
        command: "git",
        args,
        cwd,
        env: GIT_ENV,
        timeout,
        maxOutputBytes: MAX_DIFF_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        Effect.mapError(
          (cause) => new PrReviewError({ detail: `git ${args[0]} failed: ${cause.message}` }),
        ),
        Effect.flatMap((output) =>
          output.code === 0
            ? Effect.succeed(output.stdout)
            : Effect.fail(
                new PrReviewError({
                  detail: `git ${args[0]} failed: ${output.stderr.trim().slice(0, 300)}`,
                }),
              ),
        ),
      );

  /**
   * A detached checkout of the pull request head, below the state directory, with the diffs and
   * the pull request's text written beside the code for the agent to read. Nothing in the
   * checkout runs: no setup script (see `checkouts.ts`), hooks come from the project's own git
   * directory, and diffs skip external drivers.
   */
  const prepare = Effect.fn("PrReviewCheckout.prepare")(function* (input: {
    readonly stateDir: string;
    readonly projectRoot: string;
    readonly repository: string;
    readonly number: number;
    readonly headSha: string;
    readonly baseRef: string;
    readonly previousSha: string | null;
    readonly checkoutName: string;
    readonly pullRequestText: string;
  }) {
    const remote = pickRemote(yield* git(input.projectRoot, ["remote", "-v"]), input.repository);
    const headRef = `refs/t3-review/pr-${input.number}`;
    const baseRefName = `refs/t3-review/base-${input.number}`;
    yield* git(
      input.projectRoot,
      [
        "fetch",
        "--no-tags",
        "--no-recurse-submodules",
        remote,
        `+refs/pull/${input.number}/head:${headRef}`,
        `+refs/heads/${input.baseRef}:${baseRefName}`,
      ],
      "10 minutes",
    );
    yield* git(input.projectRoot, ["cat-file", "-e", `${input.headSha}^{commit}`]).pipe(
      Effect.mapError(
        () =>
          new PrReviewError({
            detail: `The fetched pull request does not contain ${input.headSha}.`,
          }),
      ),
    );
    const root = path.join(input.stateDir, REVIEW_CHECKOUTS_DIRNAME);
    yield* fs
      .makeDirectory(root, { recursive: true })
      .pipe(
        Effect.mapError(
          () => new PrReviewError({ detail: "Could not create the review checkout directory." }),
        ),
      );
    const checkout = path.join(root, input.checkoutName);
    yield* git(
      input.projectRoot,
      ["worktree", "add", "--detach", checkout, input.headSha],
      "10 minutes",
    );
    const mergeBase = (yield* git(input.projectRoot, [
      "merge-base",
      baseRefName,
      input.headSha,
    ])).trim();
    const diffArgs = ["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
    const files: Array<readonly [string, string]> = [
      ["pr.diff", yield* git(input.projectRoot, [...diffArgs, mergeBase, input.headSha])],
      ["pull-request.md", input.pullRequestText],
    ];
    if (input.previousSha !== null) {
      const isAncestor = yield* git(input.projectRoot, [
        "merge-base",
        "--is-ancestor",
        input.previousSha,
        input.headSha,
      ]).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (isAncestor) {
        files.push([
          "incremental.diff",
          yield* git(input.projectRoot, [...diffArgs, input.previousSha, input.headSha]),
        ]);
      }
    }
    yield* writeReviewFiles(checkout, files);
    return {
      checkout: { path: checkout, mergeBase } satisfies PreparedCheckout,
      incremental: files.some(([name]) => name === "incremental.diff"),
    };
  });

  const writeReviewFiles = Effect.fn("PrReviewCheckout.writeFiles")(
    function* (checkout: string, files: ReadonlyArray<readonly [string, string]>) {
      const dir = path.join(checkout, REVIEW_DIR);
      yield* fs.makeDirectory(dir, { recursive: true });
      for (const [name, content] of files) {
        yield* fs.writeFileString(path.join(dir, name), content);
      }
    },
    Effect.mapError(() => new PrReviewError({ detail: "Could not write the review files." })),
  );

  return { prepare, writeReviewFiles };
});
