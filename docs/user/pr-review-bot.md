# PR review bot

Mention the bot on a GitHub pull request and one of your T3 Code environments reviews it in a T3 thread, then posts one GitHub review: a summary plus inline comments on the lines it found problems in. Set it up under **Settings → PR reviews**, separately on each environment that should review.

Reviews are not running yet. You can prepare the identity, repositories, and reviewer rules now; an update turns reviews on.

## Set it up

1. Choose who posts the reviews:
   - **GitHub App** (recommended): reviews come from the App's own bot account. Use **Create the App on GitHub**, or create one by hand with Webhook off and these repository permissions only: Pull requests read and write, Issues read and write, Contents read. Copy its App ID, generate a private key, install it on the repositories to review, and enter the installation ID (the number at the end of the installation page's URL). Paste the key's `.pem` contents and choose **Store key**; it stays in the environment's secret store and is never sent back to any client.
   - **gh login**: reviews post as the account `gh auth login` signed into on that environment, marked as an automated T3 Code review.
2. Add each repository as `owner/name` with the project whose checkout holds it.
3. Pick reviewers. Rules match who wrote the change (found from the T3 thread that created or pushed the pull request, else `Co-Authored-By` trailers on its commits) and choose the provider, model, and effort to review it, such as "written by Codex, review with Claude". The first matching rule wins; **Otherwise** covers the rest.
