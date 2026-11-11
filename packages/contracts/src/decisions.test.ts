import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { DecisionSettings, DEFAULT_DECISION_SETTINGS } from "./decisions.ts";

it("accepts HTTPS and local or tailnet HTTP decision endpoints only", () => {
  const decode = Schema.decodeUnknownSync(DecisionSettings);
  for (const customBaseUrl of [
    "https://example.test/v1",
    "http://localhost:8080/v1",
    "http://127.0.0.1/v1",
    "http://[::1]/v1",
    "http://100.64.1.2/v1",
    "http://router.example.ts.net/v1",
  ]) {
    expect(
      decode({ ...DEFAULT_DECISION_SETTINGS, source: "custom", customBaseUrl }).customBaseUrl,
    ).toBe(customBaseUrl);
  }
  for (const customBaseUrl of [
    "http://example.com/v1",
    "http://192.168.1.2/v1",
    "http://100.128.0.1/v1",
    "ftp://localhost/v1",
    "https://user:password@example.com/v1",
    "https://example.com/v1?key=secret",
    "not a url",
  ]) {
    expect(() =>
      decode({ ...DEFAULT_DECISION_SETTINGS, source: "custom", customBaseUrl }),
    ).toThrow();
  }
});
