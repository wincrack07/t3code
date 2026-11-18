import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decodeJsonReply, fromRunner } from "./textGenerationOperations.ts";

// regression: #23726 a reply that echoes the schema key replaced the seed title with "title"
it.effect("fails a thread title reply that is only the schema key", () =>
  Effect.gen(function* () {
    const textGeneration = fromRunner("Stub", (request) =>
      decodeJsonReply(request, "Stub", '{"title":"title","needsRefinement":false}'),
    );

    const outcome = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "$implement Issue #140",
        modelSelection: {
          instanceId: ProviderInstanceId.make("pi"),
          model: "anthropic/claude-haiku-4-5",
        },
      })
      .pipe(Effect.match({ onFailure: (error) => error, onSuccess: (result) => result }));

    assert.instanceOf(outcome, TextGenerationError);
    assert.strictEqual(outcome.operation, "generateThreadTitle");
  }),
);

it.effect("tells prompt-only runners the transcription reply shape", () =>
  Effect.gen(function* () {
    let prompt = "";
    const textGeneration = fromRunner("Stub", (request) => {
      prompt = request.prompt;
      return decodeJsonReply(request, "Stub", '{"transcription":"Rewritten draft."}');
    });

    const generated = yield* textGeneration.generateTranscriptionPostProcessing({
      cwd: process.cwd(),
      prompt: "Rewrite the draft.",
      modelSelection: { instanceId: ProviderInstanceId.make("cursor"), model: "composer-2" },
    });

    assert.strictEqual(generated.transcription, "Rewritten draft.");
    assert.match(prompt, /JSON object with one key, transcription/);
  }),
);
