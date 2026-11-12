import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CodexSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../apps/server/src/config.ts";
import {
  buildProjectGroupSuggestionPrompt,
  parseProjectGroupSuggestion,
} from "../../apps/server/src/projectGroupSuggestions/ProjectGroupSuggestions.ts";
import { makeCodexTextGeneration } from "../../apps/server/src/textGeneration/CodexTextGeneration.ts";
import { cases } from "./cases.ts";
import { grade } from "./grade.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string" },
    case: { type: "string" },
    samples: { type: "string", default: "3" },
  },
});
const { out, model } = values;
const samples = Number(values.samples);
const fixtures = cases.filter((fixture) => !values.case || fixture.id === values.case);
if (!out || !model || !fixtures.length || !Number.isSafeInteger(samples) || samples < 1) {
  throw new Error(
    "Use --out <directory> --model <configured model> [--case <id>] [--samples <count>].",
  );
}
const decodeSettings = Schema.decodeEffect(CodexSettings);
const encodeRows = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-project-groups-eval-" });
    const service = yield* makeCodexTextGeneration(yield* decodeSettings({}));
    const results = [];
    const summary = [];
    for (const fixture of fixtures) {
      let failed = 0;
      for (let sample = 1; sample <= samples; sample++) {
        const { transcription } = yield* service.generateTranscriptionPostProcessing({
          cwd,
          prompt: buildProjectGroupSuggestionPrompt(fixture.input),
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model },
        });
        const failures = grade(fixture, parseProjectGroupSuggestion(fixture.input, transcription));
        if (failures.length > 0) failed++;
        results.push({ id: fixture.id, sample, text: transcription, failures });
      }
      summary.push({ id: fixture.id, failed, samples, pass: failed * 2 < samples });
    }
    yield* fs.makeDirectory(out, { recursive: true });
    yield* fs.writeFileString(path.join(out, "results.json"), yield* encodeRows(results));
    yield* fs.writeFileString(path.join(out, "summary.json"), yield* encodeRows(summary));
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-project-groups-eval-state-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  ),
);
