# Exporting and importing chats

In a thread's menu, choose **Export chat… (Markdown)** for a readable copy or **Export chat… (JSON)** for a portable `.t3thread.json` file.

In **Settings → General → Chat backup**, choose **Export all chats** to download a ZIP from every currently connected environment, including archived chats. Connect offline environments first to include them. Each project folder contains Markdown, matching JSON files, and an `_index.md` with newest-first links.

Save the download in your Google Drive, iCloud, or Dropbox folder to keep a cloud copy. Extract the ZIP inside an Obsidian vault to use its frontmatter, tags, and thread links. Exports are snapshots; later changes require another export.

To restore chats, choose a destination environment/project in **Chat backup**, then **Import chats…** and select JSON files or an export ZIP. The command palette's **Import chats…** opens these settings. A project with the original workspace path on that environment takes priority over the selected project. Create a destination project first if none exists. Import requires permission to change threads. Importing the same source thread again keeps the existing import, including any new conversation added to it.

An imported chat shows its source machine and original date. Its next message starts a fresh provider session with the imported conversation supplied through the normal [handoff budget](./portable-handoffs.md). Large histories may not fit entirely in the initial context; the agent can read older messages from the thread.

Exports include user/assistant text, plans, timestamps, and attachment names. Attachment bytes, workspace files, provider sessions, reasoning, tool output, checkpoints, and approval state are excluded. Bundles stay below 10 MB by dropping the oldest conversation entries if necessary, with an explicit omission note. JSON files are limited to 10 MB on import; use batches smaller than 100 MB. Export and import controls are available in web and desktop; native mobile controls are not included yet.
