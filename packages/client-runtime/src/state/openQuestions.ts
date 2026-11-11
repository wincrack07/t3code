import type { OpenQuestion, OpenQuestionsUpdate, RunId } from "@t3tools/contracts";

/** What the user picked on one card before sending. Local until sent. */
export interface OpenQuestionDraft {
  readonly choice?: string | undefined;
  readonly detail?: string | undefined;
  /** "Later": keep the question open and send nothing for it. */
  readonly later?: boolean | undefined;
}

export type OpenQuestionDrafts = Readonly<Record<string, OpenQuestionDraft>>;

const LABEL_MAX_LENGTH = 80;
/** A typed reply is the message itself; the question keeps a one-line excerpt. */
const OPEN_QUESTION_ANSWER_STORED_LENGTH = 240;

/** The questions a run's final reply shows, in the order the agent declared them. */
export function runOpenQuestions(
  questions: ReadonlyArray<OpenQuestion> | undefined,
  runId: RunId,
): ReadonlyArray<OpenQuestion> {
  return questions?.filter((question) => question.runId === runId) ?? [];
}

/** A chip, a typed detail, or both as `Chip: detail`. Null when nothing is chosen. */
export function openQuestionAnswer(draft: OpenQuestionDraft | undefined): string | null {
  if (draft?.later) return null;
  const choice = draft?.choice?.trim() ?? "";
  const detail = draft?.detail?.replace(/\s+/gu, " ").trim() ?? "";
  if (choice && detail) return `${choice}: ${detail}`;
  return choice || detail || null;
}

/** A plain one-line name for the question: its text up to the first `:` or `?`. */
export function openQuestionLabel(text: string): string {
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_~#>]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const head = plain.split(/[:?]/u, 1)[0]?.trim() || plain;
  return head.length > LABEL_MAX_LENGTH
    ? `${head.slice(0, LABEL_MAX_LENGTH - 1).trimEnd()}…`
    : head;
}

/** The recommended answer first, then the rest in declared order. */
export function openQuestionOptions(question: OpenQuestion): ReadonlyArray<string> {
  const primary =
    question.recommended !== undefined && question.suggestions.includes(question.recommended)
      ? question.recommended
      : question.suggestions[0];
  return primary === undefined
    ? question.suggestions
    : [primary, ...question.suggestions.filter((suggestion) => suggestion !== primary)];
}

/** What the card above the composer shows: one open question at a time. */
export interface OpenQuestionDeck {
  readonly open: ReadonlyArray<OpenQuestion>;
  readonly index: number;
  readonly question: OpenQuestion;
}

/** The shown question, or the first open one when nothing (or a settled one) was picked. */
export function openQuestionDeck(
  questions: ReadonlyArray<OpenQuestion> | undefined,
  shownId: string | null,
): OpenQuestionDeck | null {
  const open = questions?.filter((question) => question.status === "open") ?? [];
  if (open.length === 0) return null;
  const found = open.findIndex((question) => question.id === shownId);
  const index = found === -1 ? 0 : found;
  return { open, index, question: open[index]! };
}

/**
 * After picking an answer on the deck: the next open question still without one,
 * or `send` when every open question has an answer (or was set aside for later).
 */
export function nextAfterOpenQuestionAnswer(
  deck: OpenQuestionDeck,
  drafts: OpenQuestionDrafts,
): { readonly kind: "send" } | { readonly kind: "show"; readonly id: string } {
  const pending = (question: OpenQuestion) =>
    drafts[question.id]?.later !== true && openQuestionAnswer(drafts[question.id]) === null;
  for (let step = 1; step < deck.open.length; step += 1) {
    const question = deck.open[(deck.index + step) % deck.open.length]!;
    if (pending(question)) return { kind: "show", id: question.id };
  }
  return { kind: "send" };
}

/** The composer's own text, verbatim, answering one question. */
export interface OpenQuestionReply {
  readonly id: string;
  readonly text: string;
}

/**
 * One ordinary user message tying each answer to its question, plus the
 * status update that closes those questions. Unanswered questions stay open.
 * Answers are numbered by their card's place among the run's questions.
 */
export function assembleOpenQuestionAnswers(
  questions: ReadonlyArray<OpenQuestion>,
  drafts: OpenQuestionDrafts,
  reply?: OpenQuestionReply,
): {
  readonly text: string;
  readonly update: Extract<OpenQuestionsUpdate, { readonly action: "set_status" }>;
} | null {
  const numbers = new Map<string, number>();
  const runCounts = new Map<RunId | null, number>();
  for (const question of questions) {
    const number = (runCounts.get(question.runId) ?? 0) + 1;
    runCounts.set(question.runId, number);
    numbers.set(question.id, number);
  }
  const answered = questions.flatMap((question) => {
    if (question.status !== "open") return [];
    const replyText = reply?.id === question.id ? reply.text.trim() : "";
    const line = replyText || openQuestionAnswer(drafts[question.id]);
    if (line === null) return [];
    const answer = replyText
      ? replyText.replace(/\s+/gu, " ").slice(0, OPEN_QUESTION_ANSWER_STORED_LENGTH)
      : line;
    return [{ question, number: numbers.get(question.id)!, line, answer }];
  });
  if (answered.length === 0) return null;
  return {
    text: answered
      .map(
        ({ question, number, line }) => `${number} · ${openQuestionLabel(question.text)} → ${line}`,
      )
      .join("\n"),
    update: {
      action: "set_status",
      updates: answered.map(({ question, answer }) => ({
        id: question.id,
        status: "answered" as const,
        answer,
      })),
    },
  };
}
