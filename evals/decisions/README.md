# Decisions

Tests the production routing prompt with synthetic tasks: prompt injection, ordinary cheap work,
and a complex concurrency repair. The runner imports the production prompt builder.

From `evals/`, run `pnpm decisions --out runs/decisions --model <configured Codex model>`.
Optional flags: `--case <id>`, `--samples <count>` (default 3), `--baseline <results.json>`.
It writes results plus a blinded review and answer key; grade against each case's rubric.
A case fails when at least half its samples fail. Add cases in `cases.ts` with their source.
Each sample is one paid text-generation call through the local Codex CLI; cost depends on model
and subscription. No paid run was performed during implementation.
