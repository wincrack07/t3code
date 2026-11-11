# PR review bot

Mention the bot on a GitHub pull request and one of your T3 Code environments reviews it in a T3 thread, then posts one GitHub review: a summary plus inline comments on the lines it found problems in. Set it up under **Settings → PR reviews**, separately on each environment that should review.

## Set it up

1. Turn on **Review pull requests from this environment** to poll GitHub for review requests and new heads. Turning it off stops polling; you can still explicitly request or re-run a review for a configured repository.
2. Choose who posts the reviews:
   - **GitHub App** (recommended): reviews come from the App's own bot account. Use **Create the App on GitHub**, or create one by hand with Webhook off and these repository permissions only: Pull requests read and write, Issues read and write, Contents read. Copy its App ID, generate a private key, install it on the repositories to review, and enter the installation ID (the number at the end of the installation page's URL). Paste the key's `.pem` contents and choose **Store key**; it stays in the environment's secret store and is never sent back to any client.
   - **gh login**: reviews post as the account `gh auth login` signed into on that environment, marked as an automated T3 Code review.
3. Add each repository as `owner/name` with the project whose checkout holds it.
4. Pick reviewers. Rules match who wrote the change (found from the T3 thread that created or pushed the pull request, else `Co-Authored-By` trailers on its commits) and choose the provider, model, and effort to review it, such as "written by Codex, review with Claude". The first matching rule wins; **Otherwise** covers the rest.

The environment checks GitHub about once a minute, so it works on a machine reachable only over a private network.

## Ask for a review

- Comment `@t3 review` on the pull request (the command is configurable). Text after it becomes the reviewer's focus, such as `@t3 review check the migration`.
- Request the GitHub App as a reviewer.
- Turn on **Auto-review** for a repository to review every new pull request and every push to one. After the first review, later pushes are reviewed incrementally.
- From a thread with a linked pull request, run **Request T3 review of linked pull request** from the command palette. Agents can do the same with the `request_pr_review` tool.

By default only repository collaborators with write access can ask. **Allowed users** replaces that with a list of logins. Comments from bots, including the review bot, are ignored.

Reply to one of the bot's inline comments with the command and a question, and the same review thread answers in that conversation.

## Several environments

Give each reviewing environment a **Priority**: 0 reviews first, and higher numbers wait one **Claim grace** period per step. The environment that reviews posts a short "T3 Code is reviewing" comment on the pull request, which tells the others to stand down. Each head commit is reviewed once; use **Re-run** in the history to review it again.

## What the reviewer can do

The review thread works in a separate checkout of the pull request, in **Supervised** mode: it reads and searches files, and any command it tries waits for your approval in the thread. It never pushes, merges, approves, or blocks a pull request; T3 Code posts its findings as a comment review. The pull request's title, description, diff, and comments are treated as untrusted text, and the project's setup script never runs in the review checkout.

The history in **Settings → PR reviews** lists each review with its thread, the GitHub review, and its status.
