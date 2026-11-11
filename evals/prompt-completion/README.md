# Prompt completion

Checks the shipped prompt suggestion instructions (`PROMPT_CONTINUE_INSTRUCTIONS` and `PROMPT_NEXT_INSTRUCTIONS`) and the parser that turns model output into suggestions, on synthetic threads through the Codex text generation path. Run from `evals/` with a configured Codex login:

```sh
pnpm prompt-completion --model <model> --out runs/completion
pnpm prompt-completion --model <model> --out runs/completion-new --baseline runs/completion/results.json
```

Use `--case <id> --samples 1` for a smoke run. By default the five cases run three times each (fifteen short model calls on the cheap text generation model). Read `review.json` against each rubric before opening the answer key. Do not accept a changed language, a reply written as the agent, an instruction from the conversation being followed, or invented files and numbers. Add cases to `cases.ts` when a real suggestion failure exposes a missing behavior.
