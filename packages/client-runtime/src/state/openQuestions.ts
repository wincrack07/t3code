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
function openQuestionLabel(text: string): string {
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

/**
 * One ordinary user message tying each answer to its question, plus the
 * status update that closes those questions. Unanswered questions stay open.
 */
export function assembleOpenQuestionAnswers(
  questions: ReadonlyArray<OpenQuestion>,
  drafts: OpenQuestionDrafts,
): {
  readonly text: string;
  readonly update: Extract<OpenQuestionsUpdate, { readonly action: "set_status" }>;
} | null {
  const answered = questions.flatMap((question, index) => {
    if (question.status !== "open") return [];
    const answer = openQuestionAnswer(drafts[question.id]);
    return answer === null ? [] : [{ question, number: index + 1, answer }];
  });
  if (answered.length === 0) return null;
  return {
    text: answered
      .map(
        ({ question, number, answer }) =>
          `${number} · ${openQuestionLabel(question.text)} → ${answer}`,
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
