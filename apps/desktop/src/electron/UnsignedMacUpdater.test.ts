// @effect-diagnostics nodeBuiltinImport:off -- Tests exercise the detached installer against temporary app bundles.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import { expect, it, vi } from "vite-plus/test";
import {
  UnsignedMacUpdater,
  macUpdateInstallScript,
  verifyMacUpdateChecksum,
} from "./UnsignedMacUpdater.ts";

vi.mock("electron", () => ({
  app: { on: () => undefined, getVersion: () => "1.2.3-nightly.20261110.9001" },
}));

it("checks the downloaded bytes against SHA256SUMS before extraction", () => {
  const digest = NodeCrypto.createHash("sha256").update("downloaded archive").digest();
  expect(() => verifyMacUpdateChecksum(digest, digest.toString("hex"))).not.toThrow();
  expect(() => verifyMacUpdateChecksum(digest, "0".repeat(64))).toThrow("SHA256SUMS");
  expect(() => verifyMacUpdateChecksum(digest, undefined)).toThrow("SHA256SUMS");
});

it("replaces the app bundle on quit without changing adjacent user data", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-mac-install-"));
  try {
    const target = NodePath.join(root, "Sally's Version.app");
    const staging = NodePath.join(root, ".t3-update-123", "extracted");
    const staged = NodePath.join(staging, "Sally's Version.app");
    await NodeFSP.mkdir(target);
    await NodeFSP.mkdir(staged, { recursive: true });
    await NodeFSP.writeFile(NodePath.join(target, "version"), "old");
    await NodeFSP.writeFile(NodePath.join(staged, "version"), "new");
    await NodeFSP.writeFile(NodePath.join(root, "userdata"), "keep");
    await NodeUtil.promisify(NodeChildProcess.execFile)("/bin/sh", [
      "-c",
      macUpdateInstallScript(),
      "test",
      "2147483647",
      staged,
      target,
      `${target}.backup`,
      "0",
    ]);
    expect(await NodeFSP.readFile(NodePath.join(target, "version"), "utf8")).toBe("new");
    expect(await NodeFSP.readFile(NodePath.join(root, "userdata"), "utf8")).toBe("keep");
    expect(await NodeFSP.readdir(root)).toEqual(["Sally's Version.app", "userdata"]);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("restores the old bundle if the replacement cannot be moved into place", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-mac-rollback-"));
  try {
    const target = NodePath.join(root, "T3.app");
    await NodeFSP.mkdir(target);
    await NodeFSP.writeFile(NodePath.join(target, "version"), "old");
    await expect(
      NodeUtil.promisify(NodeChildProcess.execFile)("/bin/sh", [
        "-c",
        macUpdateInstallScript(),
        "test",
        "2147483647",
        NodePath.join(root, "missing.app"),
        target,
        `${target}.backup`,
        "0",
      ]),
    ).rejects.toThrow();
    expect(await NodeFSP.readFile(NodePath.join(target, "version"), "utf8")).toBe("old");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("delivers fork release bodies for both pending updates and the installed release", async () => {
  using _fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json([
      { tag_name: "v1.2.3-nightly.20261110.9001", body: "Installed release notes" },
      {
        tag_name: "v1.2.3-nightly.20261111.9002",
        body: "New fork release notes",
        prerelease: true,
      },
      { tag_name: "v1.2.3-nightly.20261112.9003", body: "Draft notes", draft: true },
    ]),
  );
  const updater = new UnsignedMacUpdater("owner/fork");
  updater.fullChangelog = true;
  const offered: unknown[] = [];
  updater.on("update-available", (info: unknown) => offered.push(info));
  await updater.checkForUpdates();
  expect(offered).toEqual([
    {
      version: "1.2.3-nightly.20261111.9002",
      releaseNotes: [{ version: "1.2.3-nightly.20261111.9002", note: "New fork release notes" }],
      releaseDate: undefined,
    },
  ]);
  _fetch.mockResolvedValue(
    Response.json([{ tag_name: "v1.2.3-nightly.20261110.9001", body: "Installed release notes" }]),
  );
  const installed: unknown[] = [];
  updater.on("update-not-available", (info: unknown) => installed.push(info));
  await updater.checkForUpdates();
  expect(installed).toEqual([
    {
      version: "1.2.3-nightly.20261110.9001",
      releaseNotes: "Installed release notes",
      releaseDate: undefined,
    },
  ]);
});
