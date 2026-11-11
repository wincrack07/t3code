// @effect-diagnostics nodeBuiltinImport:off -- Runs the generated JavaScript encoder without macOS.
import { describe, expect, it } from "vite-plus/test";
import * as NodeVM from "node:vm";
import { finderWorkflow } from "./FinderWorkflow.ts";
import { readFinderLink } from "@t3tools/shared/finderIntegration";

describe("Finder workflow", () => {
  it("uses Finder file input, argument passing, and the exact channel bundle", () => {
    const workflow = finderWorkflow("/Applications/T3 Code (Sally's Version).app", "t3code");
    expect(workflow.info).toContain("NSSendFileTypes");
    expect(workflow.info).toContain("public.item");
    expect(workflow.info).toContain("com.apple.finder");
    expect(workflow.info).toContain("Send to T3 Code");
    expect(workflow.document).toContain("com.apple.Automator.fileSystemObject");
    expect(workflow.document).toContain("<key>inputMethod</key><integer>1</integer>");
    expect(workflow.document).toContain("Run Shell Script.action");
    expect(workflow.document).toContain("&amp;");
    expect(workflow.script).toContain('JavaScript - "$@"');
    expect(workflow.script).toContain("Sally'\\''s Version");
    const encoder = workflow.script.split("<<'T3_FINDER_JXA'\n")[1]!.split("\nT3_FINDER_JXA")[0]!;
    const paths = ["/tmp/space name", "/tmp/'\"quotes", "/tmp/a\nb", "/tmp/$(touch injected)"];
    expect(readFinderLink(NodeVM.runInNewContext(`${encoder}; run(paths)`, { paths }))).toEqual(
      paths,
    );
    expect(workflow.script).toContain("exec /usr/bin/open -a");
  });
});
