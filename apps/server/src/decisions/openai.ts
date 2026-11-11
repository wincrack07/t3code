import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { DECISION_OUTPUT_SCHEMA } from "./prompt.ts";

const Completion = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      finish_reason: Schema.String,
      message: Schema.Struct({ content: Schema.NullOr(Schema.String) }),
    }),
  ),
});

export const requestOpenAiDecision = Effect.fn("Decisions.openai")(function* (
  apiKey: string,
  model: string,
  prompt: string,
) {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http
    .execute(
      HttpClientRequest.post("https://api.openai.com/v1/chat/completions").pipe(
        HttpClientRequest.bearerToken(apiKey),
        HttpClientRequest.bodyJsonUnsafe({
          model,
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: 160,
          response_format: {
            type: "json_schema",
            json_schema: { name: "decision", strict: true, schema: DECISION_OUTPUT_SCHEMA },
          },
        }),
      ),
    )
    .pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    );
  if (response.status < 200 || response.status >= 300)
    return yield* Effect.fail("Decision API failed");
  const completion = yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Completion)),
  );
  const choice = completion.choices[0];
  if (choice?.finish_reason !== "stop" || !choice.message.content)
    return yield* Effect.fail("Decision API returned no complete answer");
  return choice.message.content;
});
