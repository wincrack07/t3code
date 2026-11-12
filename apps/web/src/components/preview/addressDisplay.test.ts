import { describe, expect, it } from "vitest";

import { formatAddressForDisplay } from "./addressDisplay";

describe("formatAddressForDisplay", () => {
  it.each([
    ["http://localhost:5173/", "localhost:5173"],
    ["https://example.com", "example.com"],
    ["https://example.com/docs/getting-started", "example.com/docs/getting-started"],
    ["http://127.0.0.1:8080/api", "127.0.0.1:8080/api"],
    ["http://[::1]:3000/", "[::1]:3000"],
    [
      "https://a-very-long-subdomain.preview.staging.example-company.internal/",
      "a-very-long-subdomain.preview.staging.example-company.internal",
    ],
    ["https://example.com/search?q=t3&page=2#results", "example.com/search?q=t3&page=2#results"],
    ["https://user:secret@example.com/private", "example.com/private"],
    ["file:///Users/me/report.pdf", "file:///Users/me/report.pdf"],
    ["about:blank", "about:blank"],
    ["data:text/html,<p>hi</p>", "data:text/html,<p>hi</p>"],
    ["", ""],
    ["http://", "http://"],
  ])("%s → %s", (url, expected) => {
    expect(formatAddressForDisplay(url)).toBe(expected);
  });
});
