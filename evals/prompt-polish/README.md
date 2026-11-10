# Prompt polish

Checks the shipped `/polish` prompt and Codex text generation path on synthetic drafts. Run from `evals/` with a configured Codex login:

```sh
pnpm prompt-polish --model <model> --out runs/polish
pnpm prompt-polish --model <model> --out runs/polish-new --baseline runs/polish/results.json
```

Use `--case <id> --samples 1` for a smoke run. By default the five cases run three times each (fifteen short model calls). Read `review.json` against each rubric before opening the answer key. Allow rewording; do not accept a changed language, an altered link, mention, skill or model token, an added requirement, or an output that answers the draft instead of rewriting it. Add cases to `cases.ts` when an actual polish failure exposes a missing behavior.
