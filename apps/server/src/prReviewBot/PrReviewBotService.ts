import {
  CommandId,
  type EnvironmentId,
  MessageId,
  type ModelSelection,
  PrReviewConfig,
  PrReviewError,
  type PrReviewIdentityStatus,
  type PrReviewRecord,
  type PrReviewRequestInput,
  type PrReviewState,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { listLinkedPullRequestThreads } from "../pullRequest/linkedThreads.ts";
import * as ServerSettings from "../serverSettings.ts";
import { claim, settleClaim, type ClaimTarget } from "./claimFlow.ts";
import { claimDelayMs, headClaimKey, parseClaim } from "./claims.ts";
import {
  GitHubCallError,
  isValidPrivateKey,
  makeAppIdentity,
  makeFetchSend,
  makeGhIdentity,
  type GitHubSend,
} from "./githubClient.ts";
import { makeGitHubReviewApi, type PrReviewGitHubApi, type Pull } from "./githubReviewApi.ts";
import { nextPollDelayMs } from "./pollingBackoff.ts";
import { initialCursor, pollRepository } from "./poller.ts";
import { makeReviewCheckouts } from "./reviewCheckout.ts";
import { mapFindingsToComments, parseReviewOutput, type ReviewFinding } from "./reviewFindings.ts";
import {
  buildFollowUpPrompt,
  buildReviewPrompt,
  pullRequestFile,
  questionFile,
} from "./reviewPrompt.ts";
import { detectAuthorProvider, selectReviewer } from "./reviewerRules.ts";
import {
  StoredPrReviewState,
  type ReviewTrigger,
  type StoredPrReviewState as Stored,
} from "./state.ts";
import { BOT_MARKER } from "./triggers.ts";

const PRIVATE_KEY_SECRET = "pr-review-github-app-private-key";
const STATE_FILE = "pr-reviews.json";
const MAX_HISTORY = 200;
const MAX_CONCURRENT_REVIEWS = 2;
const REVIEW_TIMEOUT = Duration.minutes(45);
const FOLLOW_UP_TIMEOUT = Duration.minutes(15);

type ReviewRequest =
  | ReviewTrigger
  | {
      readonly kind: "manual";
      readonly repository: string;
      readonly number: number;
      readonly focus: string;
      /** Re-run: reviews the head again even though it was reviewed. */
      readonly force: boolean;
    };

export class PrReviewBotService extends Context.Service<
  PrReviewBotService,
  {
    readonly getState: Effect.Effect<PrReviewState, PrReviewError>;
    readonly updateConfig: (config: PrReviewConfig) => Effect.Effect<PrReviewState, PrReviewError>;
    readonly setPrivateKey: (privateKey: string) => Effect.Effect<PrReviewState, PrReviewError>;
    /** Reviews the pull request linked to a thread or named by URL; returns once it is started. */
    readonly request: (input: PrReviewRequestInput) => Effect.Effect<PrReviewRecord, PrReviewError>;
    readonly rerun: (recordId: string) => Effect.Effect<PrReviewRecord, PrReviewError>;
  }
>()("t3/prReviewBot/PrReviewBotService") {}

const encodeState = Schema.encodeSync(Schema.fromJsonString(StoredPrReviewState));
const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(StoredPrReviewState));
const decodeStateSync = Schema.decodeSync(StoredPrReviewState);
const emptyState = (): Stored => decodeStateSync({});

const sameRepository = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const parsePullRequestUrl = (url: string) => {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(
    url.trim(),
  );
  return match ? { repository: match[1]!, number: Number(match[2]) } : null;
};

const short = (sha: string) => sha.slice(0, 7);

const isGitHubCallError = Schema.is(GitHubCallError);
const errorDetail = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
};
const isoAt = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

/** @public */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const runner = yield* ProcessRunner.ProcessRunner;
  const checkouts = yield* makeReviewCheckouts;
  const send: GitHubSend = yield* makeFetchSend;
  const sql = yield* SqlClient.SqlClient;
  const statePath = path.join(config.stateDir, STATE_FILE);

  const loaded = yield* fs.readFileString(statePath).pipe(
    Effect.map((text) => Option.getOrElse(decodeState(text), emptyState)),
    Effect.orElseSucceed(emptyState),
  );
  // A review the last process was running cannot finish now; its claim lapses for the next node.
  const state = yield* Ref.make<Stored>({
    ...loaded,
    history: loaded.history.map((record) =>
      record.status === "running" || record.status === "waiting"
        ? { ...record, status: "failed", detail: "The server restarted during the review." }
        : record,
    ),
  });
  const writeLock = yield* Semaphore.make(1);
  const persist = (next: Stored) =>
    fs
      .writeFileString(statePath, encodeState(next))
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not save PR review state", { cause }),
        ),
      );
  const update = <A>(f: (current: Stored) => readonly [A, Stored]) =>
    writeLock.withPermit(
      Effect.gen(function* () {
        const [result, next] = f(yield* Ref.get(state));
        yield* Ref.set(state, next);
        yield* persist(next);
        return result;
      }),
    );
  const polling = yield* Ref.make<PrReviewState["polling"]>({
    lastPollAt: null,
    backoffUntil: null,
    lastError: null,
  });
  const reviewPermits = yield* Semaphore.make(MAX_CONCURRENT_REVIEWS);
  const nowMs = Clock.currentTimeMillis;
  const nowIso = Effect.map(nowMs, isoAt);

  const saveRecord = (record: PrReviewRecord) =>
    update((current) => [
      record,
      {
        ...current,
        history: [record, ...current.history.filter((entry) => entry.id !== record.id)].slice(
          0,
          MAX_HISTORY,
        ),
      },
    ]);
  const patchRecord = (record: PrReviewRecord, patch: Partial<PrReviewRecord>) =>
    Effect.flatMap(nowIso, (updatedAt) => saveRecord({ ...record, ...patch, updatedAt }));

  const readPrivateKey = secrets.get(PRIVATE_KEY_SECRET).pipe(
    Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes))),
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  const ghToken = runner
    .run({
      command: "gh",
      args: ["auth", "token", "--hostname", "github.com"],
      timeout: "15 seconds",
    })
    .pipe(
      Effect.mapError(
        () => new PrReviewError({ detail: "The gh CLI is not installed on this environment." }),
      ),
      Effect.flatMap((output) =>
        output.code === 0 && output.stdout.trim() !== ""
          ? Effect.succeed(output.stdout.trim())
          : Effect.fail(
              new PrReviewError({
                detail: "gh is not signed in. Run `gh auth login` on this environment.",
              }),
            ),
      ),
    );
  const apiCache = yield* Ref.make<{
    readonly key: string;
    readonly api: PrReviewGitHubApi;
  } | null>(null);
  /** The GitHub client for the configured identity; rebuilt when the identity settings change. */
  const currentApi = Effect.gen(function* () {
    const identity = (yield* Ref.get(state)).config.identity;
    const privateKey =
      identity.mode === "github-app" ? yield* readPrivateKey : Option.none<string>();
    const key = [
      identity.mode,
      identity.appId,
      identity.installationId,
      identity.appSlug,
      Option.isSome(privateKey) ? privateKey.value.length : 0,
    ].join("|");
    const cached = yield* Ref.get(apiCache);
    if (cached !== null && cached.key === key) return cached.api;
    let reviewIdentity;
    if (identity.mode === "github-app") {
      if (identity.appId === "" || identity.installationId === "" || Option.isNone(privateKey)) {
        return yield* new PrReviewError({
          detail:
            "Add the GitHub App ID, installation ID and private key in Settings → PR reviews.",
        });
      }
      reviewIdentity = yield* makeAppIdentity({
        appId: identity.appId,
        installationId: identity.installationId,
        appSlug: identity.appSlug,
        privateKey: privateKey.value,
        send,
        nowMs,
      });
    } else {
      reviewIdentity = yield* makeGhIdentity({ readToken: ghToken, send });
    }
    const api = makeGitHubReviewApi(reviewIdentity, send);
    yield* Ref.set(apiCache, { key, api });
    return api;
  });

  const identityStatus = Effect.gen(function* () {
    const identity = (yield* Ref.get(state)).config.identity;
    const hasPrivateKey = Option.isSome(yield* readPrivateKey);
    const login = yield* currentApi.pipe(
      Effect.flatMap((api) => api.identity.login),
      Effect.result,
    );
    return {
      mode: identity.mode,
      hasPrivateKey,
      ready: login._tag === "Success",
      login: login._tag === "Success" ? login.success : null,
      detail:
        login._tag === "Success"
          ? identity.mode === "github-app"
            ? `Reviews post as ${login.success}.`
            : `Reviews post as ${login.success} through gh, labelled as automated.`
          : login.failure.message,
    } satisfies PrReviewIdentityStatus;
  });

  const repositoryConfig = (repository: string) =>
    Effect.map(Ref.get(state), (current) =>
      current.config.repositories.find(
        (entry) => entry.enabled && sameRepository(entry.repository, repository),
      ),
    );

  const environmentLabel = environment.getDescriptor.pipe(
    Effect.map((descriptor) => descriptor.label),
  );

  /** Providers of T3 threads that created or worked on the pull request, review threads excluded. */
  const threadProviders = Effect.fn("PrReviewBot.threadProviders")(function* (
    repository: string,
    number: number,
  ) {
    const ownThreads = new Set(
      (yield* Ref.get(state)).history.flatMap((record) =>
        record.threadId ? [record.threadId] : [],
      ),
    );
    const linked = yield* listLinkedPullRequestThreads({
      host: "github.com",
      repository,
      number,
    }).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.orElseSucceed(() => ({ threads: [] })),
    );
    const instances = (yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null)))
      ?.providerInstances;
    const providers: Array<string> = [];
    for (const linkedThread of linked.threads) {
      if (ownThreads.has(linkedThread.id)) continue;
      const shell = yield* threads
        .getThreadShell(ThreadId.make(linkedThread.id))
        .pipe(Effect.orElseSucceed(() => null));
      if (shell === null) continue;
      const instanceId = shell.modelSelection.instanceId;
      providers.push(instances?.[instanceId]?.driver ?? instanceId);
    }
    return providers;
  });

  const lastReviewedSha = (
    api: PrReviewGitHubApi,
    repository: string,
    number: number,
    current: string,
  ) =>
    api.listPullIssueComments(repository, number).pipe(
      Effect.map(
        (comments) =>
          comments
            .flatMap((comment) => {
              const parsed = parseClaim(comment.body ?? "");
              return parsed !== null && parsed.state === "done" && parsed.key.startsWith("sha-")
                ? [parsed.key.slice(4)]
                : [];
            })
            .filter((sha) => sha !== current.toLowerCase())
            .at(-1) ?? null,
      ),
      Effect.orElseSucceed(() => null),
    );

  const finalAssistantText = Effect.fn("PrReviewBot.finalAssistantText")(function* (
    projectId: ProjectId,
    threadId: ThreadId,
    timeout: Duration.Duration,
  ) {
    const waited = yield* threads
      .waitForThread({ projectId, threadId, timeoutMs: Duration.toMillis(timeout) })
      .pipe(Effect.mapError((error) => new PrReviewError({ detail: error.message })));
    if (waited.timedOut || waited.run === null) {
      return yield* new PrReviewError({ detail: "The review thread did not finish in time." });
    }
    if (waited.run.status !== "completed") {
      return yield* new PrReviewError({ detail: `The review thread ended ${waited.run.status}.` });
    }
    const records = yield* threads
      .getThreadRecords(threadId, ["messages"], {
        messageRoles: ["assistant"],
        messageRunIds: [waited.run.id],
      })
      .pipe(Effect.mapError((error) => new PrReviewError({ detail: error.message })));
    const last = records.messages.at(-1);
    if (last === undefined || last.text.trim() === "") {
      return yield* new PrReviewError({ detail: "The review thread gave no answer." });
    }
    return last.text;
  });

  const footer = (input: {
    readonly mode: "github-app" | "gh";
    readonly headSha: string;
    readonly reviewer: ModelSelection;
    readonly label: string;
    readonly recordId: string;
  }) =>
    [
      "---",
      `${input.mode === "gh" ? "🤖 Automated T3 Code review, posted with a maintainer's GitHub login. " : ""}Reviewed \`${short(input.headSha)}\` with ${input.reviewer.model} on ${input.label}. Reply to a comment with the review command to ask about it.`,
      `${BOT_MARKER} sha=${input.headSha} record=${input.recordId} -->`,
    ].join("\n\n");

  const reviewBody = (summary: string, unplaced: ReadonlyArray<ReviewFinding>, tail: string) =>
    [
      summary.trim(),
      unplaced.length === 0
        ? ""
        : [
            "**Findings outside the diff's lines**",
            ...unplaced.map(
              (finding) =>
                `- **${finding.severity.toUpperCase()}** \`${finding.path}:${finding.line}\` ${finding.title.trim()}: ${finding.body.trim()}`,
            ),
          ].join("\n"),
      tail,
    ]
      .filter((part) => part !== "")
      .join("\n\n");

  /**
   * Claims the head, checks the pull request out, runs a review thread, and posts one COMMENT
   * review. Everything after the claim reports into the record and the claim comment.
   */
  const startReview = Effect.fn("PrReviewBot.startReview")(function* (request: ReviewRequest) {
    if (request.kind === "follow-up") return null;
    const api = yield* currentApi;
    const botLogin = yield* api.identity.login;
    const repo = yield* repositoryConfig(request.repository);
    if (repo === undefined) {
      return yield* new PrReviewError({
        detail: `${request.repository} is not an enabled repository in Settings → PR reviews.`,
      });
    }
    const pull = yield* api.getPull(request.repository, request.number);
    if (pull.state !== "open") return null;
    if (request.kind !== "manual" && "headSha" in request && request.headSha !== pull.head.sha) {
      // Superseded by a newer push; that head gets its own trigger.
      return null;
    }
    const environmentId: EnvironmentId = yield* environment.getEnvironmentId;
    const label = yield* environmentLabel;
    const recordId = yield* randomUuidV4;
    const force = request.kind === "manual" && request.force;
    const target: ClaimTarget = {
      repository: request.repository,
      number: request.number,
      key: force ? `rerun-${recordId}` : headClaimKey(pull.head.sha),
    };
    const createdAt = yield* nowIso;
    const base: PrReviewRecord = {
      id: recordId,
      repository: request.repository,
      number: request.number,
      headSha: pull.head.sha,
      trigger: request.kind,
      requestedBy: "requestedBy" in request ? request.requestedBy : null,
      focus: "focus" in request ? request.focus : "",
      environmentId,
      threadId: null,
      reviewer: null,
      authorProvider: "unknown",
      status: "running",
      detail: null,
      reviewUrl: null,
      commentIds: [],
      findingCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const claimed = yield* claim({
      api,
      target,
      botLogin,
      environmentId,
      text: `👀 T3 Code is reviewing \`${short(pull.head.sha)}\` on ${label}.`,
      nowMs: yield* nowMs,
    });
    if (!claimed.won) {
      if (claimed.decision.kind === "done" && request.kind === "mention") {
        // Idempotent per identity, so every environment that sees the request can answer it.
        yield* api.react(request.repository, "issue", request.commentId, "+1").pipe(Effect.ignore);
      }
      if (request.kind === "manual") {
        return yield* new PrReviewError({
          detail:
            claimed.decision.kind === "done"
              ? `\`${short(pull.head.sha)}\` was already reviewed. Use Re-run in Settings → PR reviews to review it again.`
              : "Another environment is reviewing this head.",
        });
      }
      return null;
    }
    if (request.kind === "mention") {
      yield* api.react(request.repository, "issue", request.commentId, "eyes").pipe(Effect.ignore);
    }
    const record = yield* saveRecord(base);
    yield* runReview({
      api,
      pull,
      record,
      target,
      claimCommentId: claimed.commentId,
      repo,
      label,
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const detail = errorDetail(cause);
          const latest =
            (yield* Ref.get(state)).history.find((entry) => entry.id === record.id) ?? record;
          yield* patchRecord(latest, { status: "failed", detail });
          yield* settleClaim({
            api,
            target,
            commentId: claimed.commentId,
            environmentId,
            state: "failed",
            text: `T3 Code could not finish reviewing \`${short(pull.head.sha)}\`: ${detail}`,
            nowMs: yield* nowMs,
          }).pipe(Effect.ignore);
        }),
      ),
      reviewPermits.withPermit,
      Effect.forkDetach,
    );
    return record;
  });

  const runReview = Effect.fn("PrReviewBot.runReview")(function* (input: {
    readonly api: PrReviewGitHubApi;
    readonly pull: Pull;
    readonly record: PrReviewRecord;
    readonly target: ClaimTarget;
    readonly claimCommentId: number;
    readonly repo: { readonly projectId: ProjectId; readonly instructions: string };
    readonly label: string;
  }) {
    const { api, pull } = input;
    let record = input.record;
    const current = yield* Ref.get(state);
    const project = yield* projects.getById(input.repo.projectId).pipe(
      Effect.mapError(() => new PrReviewError({ detail: "Could not read the project." })),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new PrReviewError({ detail: "The repository's project no longer exists." }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    const commits = yield* api.listPullCommits(record.repository, record.number);
    const author = detectAuthorProvider({
      threadProviders: yield* threadProviders(record.repository, record.number),
      commitMessages: commits.map((commit) => commit.commit.message),
    });
    const chosen = selectReviewer({
      rules: current.config.rules,
      defaultReviewer: current.config.defaultReviewer,
      authorProvider: author.provider,
    }).reviewer;
    const reviewer =
      chosen ??
      (yield* settings.getSettings.pipe(
        Effect.map((value) => value.defaultModelSelection),
        Effect.orElseSucceed(() => null),
      ));
    if (reviewer === null) {
      return yield* new PrReviewError({
        detail: "Choose a default reviewer model in Settings → PR reviews.",
      });
    }
    record = yield* patchRecord(record, { reviewer, authorProvider: author.provider });

    const previousSha = yield* lastReviewedSha(
      api,
      record.repository,
      record.number,
      pull.head.sha,
    );
    const isFork =
      pull.head.repo === null ||
      !sameRepository(pull.head.repo.full_name, pull.base.repo?.full_name ?? "");
    const prepared = yield* checkouts.prepare({
      stateDir: config.stateDir,
      projectRoot: project.workspaceRoot,
      repository: record.repository,
      number: record.number,
      headSha: pull.head.sha,
      baseRef: pull.base.ref,
      previousSha,
      checkoutName: `${record.repository.replace("/", "-")}-${record.number}-${short(pull.head.sha)}-${record.id.slice(0, 8)}`,
      pullRequestText: pullRequestFile({
        title: pull.title,
        body: pull.body ?? "",
        author: pull.user?.login ?? null,
        focus: record.focus,
      }),
    });
    const instructions =
      input.repo.instructions !== "" ? input.repo.instructions : current.config.instructions;
    const commandId = CommandId.make(`pr-review:${record.id}`);
    const launched = yield* threadLaunch
      .launch({
        commandId,
        projectId: project.id,
        title: `Review ${record.repository}#${record.number} @ ${short(pull.head.sha)}`,
        modelSelection: reviewer,
        // Every command needs a person's approval (Codex also gets a read-only sandbox), so
        // nothing in the checkout runs and nothing can push.
        runtimeMode: "approval-required",
        interactionMode: "default",
        workspaceStrategy: { type: "existing_worktree", worktreePath: prepared.checkout.path },
        initialMessage: {
          messageId: MessageId.make(`pr-review:${record.id}`),
          text: buildReviewPrompt({
            repository: record.repository,
            number: record.number,
            headSha: pull.head.sha,
            baseRef: pull.base.ref,
            previousSha: prepared.incremental ? previousSha : null,
            isFork,
            instructions,
          }),
          attachments: [],
        },
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(Effect.mapError((error) => new PrReviewError({ detail: error.message })));
    record = yield* patchRecord(record, { threadId: launched.threadId });
    yield* threads
      .dispatch({
        type: "thread.pull-request.link",
        commandId: CommandId.make(`pr-review-link:${record.id}`),
        threadId: launched.threadId,
        host: "github.com",
        repository: record.repository,
        number: record.number,
        url: pull.html_url,
        source: "manual",
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not link the review thread", { cause }),
        ),
      );

    const answer = yield* finalAssistantText(project.id, launched.threadId, REVIEW_TIMEOUT);
    const output = yield* Effect.fromOption(parseReviewOutput(answer)).pipe(
      Effect.mapError(
        () =>
          new PrReviewError({ detail: "The review thread did not end with a t3-review block." }),
      ),
    );
    const files = yield* api.listPullFiles(record.repository, record.number);
    const { comments, unplaced } = mapFindingsToComments(output.findings, files);
    const tail = footer({
      mode: api.identity.mode,
      headSha: pull.head.sha,
      reviewer,
      label: input.label,
      recordId: record.id,
    });
    const review = yield* api.createReview(record.repository, record.number, {
      commitId: pull.head.sha,
      body: reviewBody(output.summary, unplaced, tail),
      comments,
    });
    const commentIds = yield* api
      .listReviewCommentIds(record.repository, record.number, review.id)
      .pipe(Effect.orElseSucceed(() => []));
    yield* patchRecord(record, {
      status: "posted",
      reviewUrl: review.html_url,
      commentIds,
      findingCount: output.findings.length,
      detail: null,
    });
    yield* settleClaim({
      api,
      target: input.target,
      commentId: input.claimCommentId,
      environmentId: record.environmentId,
      state: "done",
      text: `✅ T3 Code reviewed \`${short(pull.head.sha)}\`: ${review.html_url}`,
      nowMs: yield* nowMs,
    });
  });

  /** Answers a reply to one of this environment's review comments from the same thread. */
  const answerFollowUp = Effect.fn("PrReviewBot.answerFollowUp")(function* (
    trigger: Extract<ReviewTrigger, { kind: "follow-up" }>,
  ) {
    const record = (yield* Ref.get(state)).history.find(
      (entry) => entry.threadId !== null && entry.commentIds.includes(trigger.rootCommentId),
    );
    // Only the environment that owns the review thread holds the record, so it alone answers.
    if (record === undefined || record.threadId === null) return;
    const api = yield* currentApi;
    const repo = yield* repositoryConfig(trigger.repository);
    if (repo === undefined) return;
    const root = yield* api.getReviewComment(trigger.repository, trigger.rootCommentId);
    const shell = yield* threads
      .getThreadShell(record.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    if (shell === null || shell.worktreePath === null) return;
    const promptInput = {
      path: root.path ?? null,
      line: root.line ?? null,
      diffHunk: root.diff_hunk ?? null,
      rootComment: root.body ?? "",
    };
    yield* checkouts.writeReviewFiles(shell.worktreePath, [
      ["question.md", questionFile({ ...promptInput, question: trigger.question })],
    ]);
    yield* api.react(trigger.repository, "review", trigger.commentId, "eyes").pipe(Effect.ignore);
    const id = yield* randomUuidV4;
    yield* threads
      .sendToThread({
        projectId: shell.projectId,
        commandId: CommandId.make(`pr-review-reply:${id}`),
        threadId: record.threadId,
        messageId: MessageId.make(`pr-review-reply:${id}`),
        text: buildFollowUpPrompt(promptInput),
        attachments: [],
        mode: "queue",
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(Effect.mapError((error) => new PrReviewError({ detail: error.message })));
    const answer = yield* finalAssistantText(shell.projectId, record.threadId, FOLLOW_UP_TIMEOUT);
    yield* api.replyToReviewComment(
      trigger.repository,
      trigger.number,
      trigger.rootCommentId,
      `${answer.trim()}\n\n${BOT_MARKER} reply=${trigger.commentId} -->`,
    );
  });

  const handle = (trigger: ReviewTrigger) =>
    (trigger.kind === "follow-up" ? answerFollowUp(trigger) : startReview(trigger)).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("PR review trigger failed", { trigger, cause }),
      ),
    );

  const pollOnce = Effect.fn("PrReviewBot.pollOnce")(function* () {
    const current = yield* Ref.get(state);
    if (!current.config.enabled) return { failures: 0 };
    const api = yield* currentApi;
    const botLogin = yield* api.identity.login;
    const now = yield* nowMs;
    const delay = claimDelayMs(current.config.priority, current.config.claimGraceSeconds);
    const botComments = new Set(current.history.flatMap((record) => record.commentIds));
    for (const repo of current.config.repositories) {
      if (!repo.enabled) continue;
      const key = repo.repository.toLowerCase();
      const result = yield* pollRepository({
        api,
        repository: repo,
        config: current.config,
        botLogin,
        cursor: current.cursors[key] ?? initialCursor(isoAt(now)),
        isBotReviewComment: (id) => botComments.has(id),
      });
      yield* update((latest) => [
        undefined,
        {
          ...latest,
          cursors: { ...latest.cursors, [key]: result.cursor },
          pending: [
            ...latest.pending,
            // Follow-ups need no wait: only the environment holding the thread answers.
            ...result.triggers.map((trigger) => ({
              trigger,
              dueAt: trigger.kind === "follow-up" ? now : now + delay,
            })),
          ],
        },
      ]);
    }
    const due = yield* update((latest) => {
      const ready = latest.pending.filter((entry) => entry.dueAt <= now);
      return [ready, { ...latest, pending: latest.pending.filter((entry) => entry.dueAt > now) }];
    });
    yield* Effect.forEach(due, (entry) => handle(entry.trigger), { discard: true });
    return { failures: 0 };
  });

  yield* Effect.gen(function* () {
    let failures = 0;
    while (true) {
      const outcome = yield* pollOnce().pipe(Effect.result);
      const now = yield* nowMs;
      let retryAtMs: number | undefined;
      if (outcome._tag === "Success") {
        failures = 0;
        yield* Ref.set(polling, { lastPollAt: isoAt(now), backoffUntil: null, lastError: null });
      } else {
        failures++;
        retryAtMs = isGitHubCallError(outcome.failure) ? outcome.failure.retryAtMs : undefined;
        const wait = nextPollDelayMs({ failures, retryAtMs }, now);
        yield* Ref.set(polling, {
          lastPollAt: isoAt(now),
          backoffUntil: isoAt(now + wait),
          lastError: outcome.failure.message,
        });
      }
      yield* Effect.sleep(Duration.millis(nextPollDelayMs({ failures, retryAtMs }, now)));
    }
  }).pipe(Effect.forkScoped);

  const getState = Effect.gen(function* () {
    const current = yield* Ref.get(state);
    return {
      config: current.config,
      identity: yield* identityStatus,
      polling: yield* Ref.get(polling),
      history: current.history,
    } satisfies PrReviewState;
  });

  return PrReviewBotService.of({
    getState,
    updateConfig: Effect.fn("PrReviewBot.updateConfig")(function* (next) {
      yield* update((current) => [undefined, { ...current, config: next }]);
      return yield* getState;
    }),
    setPrivateKey: Effect.fn("PrReviewBot.setPrivateKey")(function* (privateKey) {
      const pem = privateKey.trim();
      if (pem === "") {
        yield* secrets.remove(PRIVATE_KEY_SECRET).pipe(Effect.ignore);
      } else {
        if (!isValidPrivateKey(pem)) {
          return yield* new PrReviewError({
            detail: "That is not an RSA private key in PEM form.",
          });
        }
        yield* secrets
          .set(PRIVATE_KEY_SECRET, new TextEncoder().encode(pem))
          .pipe(
            Effect.mapError(
              () => new PrReviewError({ detail: "Could not store the private key." }),
            ),
          );
      }
      yield* Ref.set(apiCache, null);
      return yield* getState;
    }),
    request: Effect.fn("PrReviewBot.request")(function* (input) {
      let target = input.url === undefined ? null : parsePullRequestUrl(input.url);
      if (input.threadId !== undefined && target === null) {
        const shell = yield* threads
          .getThreadShell(input.threadId)
          .pipe(Effect.orElseSucceed(() => null));
        const link = shell?.pullRequests?.find(
          (entry) => entry.host === "github.com" && entry.source !== "stack-dismissed",
        );
        target = link === undefined ? null : { repository: link.repository, number: link.number };
      }
      if (target === null) {
        return yield* new PrReviewError({
          detail: "Name a GitHub pull request, or link one to the thread first.",
        });
      }
      const record = yield* startReview({
        kind: "manual",
        ...target,
        focus: input.focus ?? "",
        force: false,
      }).pipe(
        Effect.catchTags({
          GitHubCallError: (error) => new PrReviewError({ detail: error.message }),
        }),
      );
      if (record === null)
        return yield* new PrReviewError({ detail: "That pull request is not open." });
      return record;
    }),
    rerun: Effect.fn("PrReviewBot.rerun")(function* (recordId) {
      const previous = (yield* Ref.get(state)).history.find((entry) => entry.id === recordId);
      if (previous === undefined)
        return yield* new PrReviewError({ detail: "That review is no longer in the history." });
      const record = yield* startReview({
        kind: "manual",
        repository: previous.repository,
        number: previous.number,
        focus: previous.focus,
        force: true,
      }).pipe(
        Effect.catchTags({
          GitHubCallError: (error) => new PrReviewError({ detail: error.message }),
        }),
      );
      if (record === null)
        return yield* new PrReviewError({ detail: "That pull request is not open." });
      return record;
    }),
  });
});

export const layer = Layer.effect(PrReviewBotService, make).pipe(
  Layer.provide(ProcessRunner.layer),
);
