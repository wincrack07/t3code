// @effect-diagnostics nodeBuiltinImport:off -- Isolated local filesystem fixture for the macOS adapter.
import { expect, it } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { makeFinderAdapter } from "./DesktopFinderIntegration.ts";

it("installs and removes only its workflow, validates paths, and bounds reads to a selection", async () => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-finder-"));
  try {
    const adapter = makeFinderAdapter({
      homeDirectory: home,
      appBundle: "/Applications/Sally's T3.app",
      supported: true,
      scheme: "t3code",
    });
    const unsupported = makeFinderAdapter({
      homeDirectory: home,
      appBundle: "/ignored",
      supported: false,
      scheme: "t3code",
    });
    expect(await unsupported.state()).toEqual({ supported: false, installed: false });
    await expect(unsupported.setInstalled(true)).rejects.toThrow("macOS");
    expect(await adapter.state()).toEqual({ supported: true, installed: false });
    expect(await adapter.setInstalled(true)).toEqual({ supported: true, installed: true });
    const workflow = NodePath.join(home, "Library/Services/Send to T3 Code.workflow");
    expect(
      await NodeFSP.readFile(NodePath.join(workflow, "Contents/document.wflow"), "utf8"),
    ).toContain("Sally");
    const file = NodePath.join(home, "'quote space\n$(touch nope)");
    await NodeFSP.writeFile(file, "content");
    const url = new URL("t3code://finder");
    url.searchParams.append("path", file);
    url.searchParams.append("path", home);
    const items = await adapter.inspect(url.href);
    expect(items.map((item) => item.kind)).toEqual(["file", "folder"]);
    expect(new TextDecoder().decode(await adapter.read(items[0]!.id))).toBe("content");
    await expect(adapter.read(items[0]!.id)).rejects.toThrow("no longer available");
    await expect(adapter.read(items[1]!.id)).rejects.toThrow("no longer available");
    await expect(adapter.inspect("t3code://finder?path=/does/not/exist")).rejects.toThrow();
    await expect(adapter.inspect("t3code://finder?path=relative")).rejects.toThrow("Invalid");
    await NodeFSP.truncate(file, 50 * 1024 * 1024 + 1);
    const large = await adapter.inspect(url.href);
    await expect(adapter.read(large[0]!.id)).rejects.toThrow("50 MiB");
    expect(await adapter.setInstalled(false)).toEqual({ supported: true, installed: false });
    await NodeFSP.mkdir(NodePath.join(workflow, "Contents"), { recursive: true });
    await expect(adapter.setInstalled(false)).rejects.toThrow("different workflow");
    await expect(adapter.setInstalled(true)).rejects.toThrow("different workflow");
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});
