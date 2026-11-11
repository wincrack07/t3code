/** Marks everything the bot writes, so it never treats its own text as a request. */
export const BOT_MARKER = "<!-- t3-review";

const MAX_FOCUS_CHARS = 2_000;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lines a reader would not take as the author asking: quotes and code. */
function authoredLines(body: string): ReadonlyArray<string> {
  const lines: Array<string> = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fenceMatch) {
      fence = fence === null ? fenceMatch[1]! : fence === fenceMatch[1] ? null : fence;
      continue;
    }
    if (fence !== null || /^\s*>/.test(line)) continue;
    lines.push(line.replace(/`[^`]*`/g, " "));
  }
  return lines;
}

/**
 * The review request in a comment, or null. The command must stand alone (not part of a longer
 * handle such as `@t3reviewer`), outside quotes and code. Text after it is the reviewer's focus.
 */
export function parseReviewCommand(
  body: string,
  command: string,
): { readonly focus: string } | null {
  if (body.includes(BOT_MARKER)) return null;
  const trimmed = command.trim();
  if (trimmed === "") return null;
  const pattern = new RegExp(
    `(?:^|[^\\w@/-])${trimmed.split(/\s+/).map(escapeRegExp).join("\\s+")}(?![\\w-])`,
    "i",
  );
  const lines = authoredLines(body);
  for (let index = 0; index < lines.length; index++) {
    const match = pattern.exec(lines[index]!);
    if (!match) continue;
    const rest = [lines[index]!.slice(match.index + match[0].length), ...lines.slice(index + 1)]
      .join("\n")
      .replace(/^[\s:,.-]+/, "")
      .trim();
    return { focus: rest.slice(0, MAX_FOCUS_CHARS) };
  }
  return null;
}

export interface CommentAuthor {
  readonly login: string;
  readonly type?: string | undefined;
}

/** Comments the bot must never answer: its own, any other bot's, and anything carrying its marker. */
export function isIgnoredAuthor(
  author: CommentAuthor | null,
  body: string,
  botLogin: string | null,
): boolean {
  if (author === null) return true;
  if (body.includes(BOT_MARKER)) return true;
  if (author.type === "Bot" || author.login.endsWith("[bot]")) return true;
  return botLogin !== null && author.login.toLowerCase() === botLogin.toLowerCase();
}

const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

/**
 * Whether `login` may ask for a review. An explicit list replaces the default, which is repository
 * collaborators with write access; `permission` is GitHub's answer for that login.
 */
export function isAllowedRequester(input: {
  readonly login: string;
  readonly allowedLogins: ReadonlyArray<string>;
  readonly permission: string | null;
}): boolean {
  const allowed = input.allowedLogins.map((login) => login.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0) return allowed.includes(input.login.toLowerCase());
  return input.permission !== null && WRITE_PERMISSIONS.has(input.permission);
}

export const hasWritePermission = (permission: string | null) =>
  permission !== null && WRITE_PERMISSIONS.has(permission);
