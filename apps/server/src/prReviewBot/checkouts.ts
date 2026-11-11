/** Pull request checkouts live here, below the server's state directory. */
export const REVIEW_CHECKOUTS_DIRNAME = "pr-review-checkouts";

/**
 * A checkout of someone else's code. Thread launches never run a project setup script in one,
 * since that would execute the pull request's own install scripts and hooks.
 */
export const isUntrustedCheckout = (worktreePath: string) =>
  worktreePath.split(/[\\/]/).includes(REVIEW_CHECKOUTS_DIRNAME);
