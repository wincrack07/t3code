# Project groups

Checks the shipped "Suggested project groups" prompt on synthetic project lists: grouping by repository owner when titles share no prefix, filling an existing group, ignoring instructions inside a title, and a control where nothing should be grouped. The runner imports the production prompt and validator, so it grades what the dialog would show.

From `evals/`, with a configured Codex login:

```sh
pnpm project-groups --model <model> --out runs/project-groups
```

Use `--case <id> --samples 1` for a smoke run. By default the four cases run three times each (twelve short model calls). `summary.json` marks a case failed when half or more of its samples fail; `results.json` holds each reply and its failures. Add cases to `cases.ts` when a real suggestion goes wrong, with its source.
