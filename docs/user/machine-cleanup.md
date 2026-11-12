# Machine cleanup

Open **Settings → Maintenance → Machine cleanup** for the environment that owns the files. Start with **Scan**: it measures free space and lists regenerable files, approval candidates, protected paths and aggressive options without deleting files.

Set your project roots and protected paths first. Project scans stop at depth seven. The worktree scan searches repositories under the environment's home directory and can take several minutes; progress and cancellation remain available.

**Clean regenerable files now** runs Phase A only. Active builds and protected paths are retained. Dependencies download again and generated builds rebuild on their next use.

Select Phase B candidates and choose **Delete selected** to review their exact paths and sizes. Confirmation applies only to those items. Eligibility is checked again immediately before deletion. Dirty worktrees, active T3 threads, protected paths and changed candidates remain untouched. Branches are kept. Worktrees marked **Probably active** are best kept.

Attachments copied into Tasks are reported under **Task attachments**, split by open, done and deleted tasks. Copies for done and deleted tasks are Phase B candidates. Copies for open tasks are never preselected and need their own confirmation, like aggressive options. A deleted task keeps its copies until you remove them here, so Undo still restores them; a task whose copy was removed shows it as missing.

Aggressive options require a separate confirmation for each item and show their effects. They also rerun regenerable cleanup. Simulator apps/data, Android virtual devices and Xcode archives can have lasting value; review those paths carefully.

Enable daily unattended cleanup to run Phase A at 06:00 local time, or choose another time. The server must be running; missed runs catch up when it becomes available. Phase B and C are never deleted by the daily timer. A relevant completed run makes at most one native notification attempt on the environment. Headless Linux or missing notification permissions may prevent delivery; the report records that failure. Relay/mobile push delivery is not provided by this notification channel.

The last report includes JSON, operational notes, and free space before and after. History supplies the free-space trend. Agents can scan, run Phase A, read status and request your review, but cannot approve Phase B or C. Files, tool output and chat replies never substitute for the client confirmation.

Machine cleanup supports macOS and Linux. macOS-only rules are absent on Linux. Windows is not supported. T3 home, agent histories, environment files and your protected paths are always excluded from deletion.
