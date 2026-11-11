import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { requestOpenAiDecision } from "./openai.ts";

it.effect("sends a strict compact request and reads only a complete answer", () =>
  Effect.gen(function* () {
    const requests: string[] = [];
    const urls: string[] = [];
    const fake = HttpClient.make((request) => {
      urls.push(request.url);
      if (request.body._tag === "Uint8Array")
        requests.push(new TextDecoder().decode(request.body.body));
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify({
              choices: [
                { finish_reason: "stop", message: { content: '{"candidate":0,"reason":"Fast"}' } },
              ],
            }),
            { status: 200 },
          ),
        ),
      );
    });
    const answer = yield* requestOpenAiDecision("fake-test-key", "test-model", "task").pipe(
      Effect.provideService(HttpClient.HttpClient, fake),
    );
    yield* requestOpenAiDecision(
      "fake-test-key",
      "custom-model",
      "task",
      "http://100.64.1.2:8080/v1/",
    ).pipe(Effect.provideService(HttpClient.HttpClient, fake));
    expect(urls).toEqual([
      "https://api.openai.com/v1/chat/completions",
      "http://100.64.1.2:8080/v1/chat/completions",
    ]);
    expect(JSON.parse(requests[1]!)).toMatchObject({ model: "custom-model" });
    expect(answer).toBe('{"candidate":0,"reason":"Fast"}');
    expect(JSON.parse(requests[0]!)).toMatchObject({
      model: "test-model",
      max_completion_tokens: 160,
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(requests[0]).not.toContain("fake-test-key");
    const truncated = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }),
          ),
        ),
      ),
    );
    expect(
      (yield* requestOpenAiDecision("fake", "test", "task").pipe(
        Effect.provideService(HttpClient.HttpClient, truncated),
        Effect.result,
      ))._tag,
    ).toBe("Failure");
  }),
);
