import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, RunId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const OPEN_QUESTION_TEXT_MAX_LENGTH = 600;
const OPEN_QUESTION_CONTEXT_MAX_LENGTH = 400;
const OPEN_QUESTION_SUGGESTION_MAX_LENGTH = 60;
const OPEN_QUESTION_ANSWER_MAX_LENGTH = 2_000;
const OPEN_QUESTIONS_PER_DECLARATION_MAX = 8;
/** Thread shells reach every client's sidebar, so the stored list stays short. */
export const OPEN_QUESTIONS_STORED_MAX = 12;

export const OpenQuestionId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(40),
  Schema.isPattern(/^[A-Za-z0-9_.-]+$/),
).annotate({ description: "Short id, unique in this thread, such as `merge-dev`." });
export type OpenQuestionId = typeof OpenQuestionId.Type;

/** `resolved`: the agent closed it; `answered` and `dismissed` come from the user. */
export const OpenQuestionStatus = Schema.Literals(["open", "answered", "dismissed", "resolved"]);
export type OpenQuestionStatus = typeof OpenQuestionStatus.Type;

const OpenQuestionFields = Schema.Struct({
  id: OpenQuestionId,
  context: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(OPEN_QUESTION_CONTEXT_MAX_LENGTH)).annotate({
      description: "One sentence: what happened and why it needs a decision.",
    }),
  ),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(OPEN_QUESTION_TEXT_MAX_LENGTH)).annotate({
    description: "The question, in Markdown.",
  }),
  suggestions: Schema.Array(
    TrimmedNonEmptyString.check(Schema.isMaxLength(OPEN_QUESTION_SUGGESTION_MAX_LENGTH)),
  )
    .check(Schema.isMinLength(2), Schema.isMaxLength(4))
    .annotate({ description: "2 to 4 short answers, such as `Yes, open it`, `Wait`." }),
  recommended: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "The suggestion you recommend, copied exactly. Omit when you have none.",
    }),
  ),
});

export const OpenQuestionDeclaration = OpenQuestionFields.check(
  Schema.makeFilter((question) =>
    question.recommended === undefined || question.suggestions.includes(question.recommended)
      ? true
      : "`recommended` must equal one of the suggestions.",
  ),
);
export type OpenQuestionDeclaration = typeof OpenQuestionDeclaration.Type;

export const OpenQuestion = Schema.Struct({
  ...OpenQuestionFields.fields,
  /** The run whose final reply shows the question. */
  runId: Schema.NullOr(RunId),
  status: OpenQuestionStatus,
  answer: Schema.optional(Schema.String.check(Schema.isMaxLength(OPEN_QUESTION_ANSWER_MAX_LENGTH))),
  createdAt: IsoDateTime,
  resolvedAt: Schema.optional(IsoDateTime),
});
export type OpenQuestion = typeof OpenQuestion.Type;

/** Lenient on read, so a later question rule never fails a whole thread. */
export const StoredOpenQuestions = Schema.Array(OpenQuestion).pipe(
  Schema.catchDecoding(() => Effect.succeedSome([])),
);

export const OpenQuestionDeclarations = Schema.Array(OpenQuestionDeclaration).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(OPEN_QUESTIONS_PER_DECLARATION_MAX),
  Schema.makeFilter((questions) =>
    new Set(questions.map((question) => question.id)).size === questions.length
      ? true
      : "Question ids must be unique.",
  ),
);

export const OpenQuestionsUpdate = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("declare"),
    runId: Schema.NullOr(RunId),
    questions: OpenQuestionDeclarations,
  }),
  Schema.Struct({
    action: Schema.Literal("set_status"),
    updates: Schema.Array(
      Schema.Struct({
        id: OpenQuestionId,
        status: OpenQuestionStatus,
        answer: Schema.optional(
          Schema.String.check(Schema.isMaxLength(OPEN_QUESTION_ANSWER_MAX_LENGTH)),
        ),
      }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(OPEN_QUESTIONS_STORED_MAX)),
  }),
]);
export type OpenQuestionsUpdate = typeof OpenQuestionsUpdate.Type;

/**
 * Declaring replaces the run's earlier questions and any reused id. Questions
 * from other runs survive only while open, and the oldest drop past the cap.
 */
export function applyOpenQuestionsUpdate(
  current: ReadonlyArray<OpenQuestion>,
  update: OpenQuestionsUpdate,
  now: string,
): ReadonlyArray<OpenQuestion> {
  if (update.action === "set_status") {
    const byId = new Map(update.updates.map((entry) => [entry.id, entry]));
    return current.map((question) => {
      const entry = byId.get(question.id);
      if (entry === undefined) return question;
      const { answer: _answer, resolvedAt: _resolvedAt, ...rest } = question;
      if (entry.status === "open") return { ...rest, status: "open" };
      return {
        ...rest,
        status: entry.status,
        ...(entry.answer === undefined ? {} : { answer: entry.answer }),
        resolvedAt: now,
      };
    });
  }
  const declaredIds = new Set(update.questions.map((question) => question.id));
  const kept = current.filter(
    (question) =>
      !declaredIds.has(question.id) &&
      question.runId !== update.runId &&
      question.status === "open",
  );
  const declared = update.questions.map((question): OpenQuestion => ({
    id: question.id,
    ...(question.context === undefined ? {} : { context: question.context }),
    text: question.text,
    suggestions: question.suggestions,
    ...(question.recommended === undefined ? {} : { recommended: question.recommended }),
    runId: update.runId,
    status: "open",
    createdAt: now,
  }));
  return [...kept, ...declared].slice(-OPEN_QUESTIONS_STORED_MAX);
}
