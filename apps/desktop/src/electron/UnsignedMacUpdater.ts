// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- Promise-based Electron updater adapter owns native I/O.
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodePath from "node:path";
import { app } from "electron";
import {
  cliReleaseChannelOf,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
  parseChecksums,
} from "@t3tools/shared/cliRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";

const run = NodeUtil.promisify(NodeChildProcess.execFile);

export function verifyMacUpdateChecksum(actual: Buffer, expected: string | undefined): void {
  if (
    expected === undefined ||
    !/^[a-f\d]{64}$/i.test(expected) ||
    !NodeCrypto.timingSafeEqual(actual, Buffer.from(expected, "hex"))
  ) {
    throw new Error("The Mac update archive failed its SHA256SUMS check.");
  }
}

export function macUpdateInstallScript(): string {
  return `set -eu
pid="$1"
staged="$2"
target="$3"
backup="$4"
relaunch="$5"
while /bin/kill -0 "$pid" 2>/dev/null; do /bin/sleep 1; done
/bin/mv "$target" "$backup"
if /bin/mv "$staged" "$target"; then
  if [ "$relaunch" = 1 ]; then /usr/bin/open "$target"; fi
  /bin/rm -rf "$backup"
  /bin/rm -rf "$(/usr/bin/dirname "$(/usr/bin/dirname "$staged")")"
else
  /bin/mv "$backup" "$target"
  if [ "$relaunch" = 1 ]; then /usr/bin/open "$target"; fi
  exit 1
fi
`;
}

export class UnsignedMacUpdater extends NodeEvents.EventEmitter {
  private selectedChannel: string | null = "nightly";
  get channel(): string | null {
    return this.selectedChannel;
  }
  set channel(value: string | null) {
    this.selectedChannel = value;
    this.targetVersion = undefined;
    const old = this.stagedBundle;
    this.stagedBundle = undefined;
    if (old !== undefined)
      void NodeFSP.rm(NodePath.resolve(old, "../.."), { recursive: true, force: true }).catch(
        () => undefined,
      );
  }
  allowDowngrade = false;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  fullChangelog = false;
  disableDifferentialDownload = true;
  private targetVersion: string | undefined;
  private stagedBundle: string | undefined;
  private installing = false;
  private source: string;

  constructor(repository: string) {
    super();
    this.source = `https://github.com/${repository}/releases/download`;
    // will-quit follows DesktopLifecycle's backend shutdown and final quit admission.
    app.on("will-quit", () => {
      if (this.autoInstallOnAppQuit && this.stagedBundle !== undefined && !this.installing) {
        this.install(false);
      }
    });
  }

  setFeedURL(): void {
    throw new Error("The unsigned Mac build uses its packaged fork release source.");
  }

  async checkForUpdates(): Promise<void> {
    const channel = this.channel === "nightly" ? "nightly" : "stable";
    const releases: Array<{
      tag_name: string;
      draft: boolean;
      body: string;
      publishedAt?: string;
    }> = [];
    for (let page = 1; page <= 10; page++) {
      const response = await fetch(cliReleaseIndexPageUrl(page, this.source), {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("Could not list fork releases.");
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error("Invalid fork release index.");
      for (const entry of body) {
        if (typeof entry !== "object" || entry === null || typeof entry.tag_name !== "string")
          continue;
        releases.push({
          tag_name: entry.tag_name,
          draft: entry.draft === true,
          body: typeof entry.body === "string" ? entry.body : "",
          ...(typeof entry.published_at === "string" ? { publishedAt: entry.published_at } : {}),
        });
      }
      if (body.length < 100) break;
    }
    const version = newestCliReleaseVersion(releases, channel);
    if (
      version === undefined ||
      compareSemverVersions(version, app.getVersion()) <= 0 ||
      cliReleaseChannelOf(version) !== channel
    ) {
      const current = releases.find(
        (release) => !release.draft && release.tag_name === `v${app.getVersion()}`,
      );
      this.emit("update-not-available", {
        version: app.getVersion(),
        releaseNotes: current?.body,
        releaseDate: current?.publishedAt,
      });
      return;
    }
    this.targetVersion = version;
    const release = releases.find((entry) => entry.tag_name === `v${version}` && !entry.draft);
    const releaseNotes = this.fullChangelog
      ? releases
          .flatMap((entry) => {
            const entryVersion = entry.tag_name.replace(/^v/, "");
            return !entry.draft &&
              /^v\d+\.\d+\.\d+/.test(entry.tag_name) &&
              cliReleaseChannelOf(entryVersion) === channel &&
              compareSemverVersions(entryVersion, app.getVersion()) > 0
              ? [{ version: entryVersion, note: entry.body }]
              : [];
          })
          .sort((a, b) => compareSemverVersions(b.version, a.version))
      : release?.body;
    this.emit("update-available", { version, releaseNotes, releaseDate: release?.publishedAt });
  }

  async downloadUpdate(): Promise<void> {
    const version = this.targetVersion;
    if (version === undefined || compareSemverVersions(version, app.getVersion()) <= 0)
      throw new Error("No newer Mac update is available.");
    const target = NodePath.resolve(process.execPath, "../../..");
    if (
      !target.endsWith(".app") ||
      target.includes("/AppTranslocation/") ||
      target.startsWith("/Volumes/")
    )
      throw new Error("Install the app in a writable Applications folder before updating.");
    await NodeFSP.access(NodePath.dirname(target), NodeFSP.constants.W_OK);
    const staging = await NodeFSP.mkdtemp(NodePath.join(NodePath.dirname(target), ".t3-update-"));
    try {
      this.emit("download-progress", { percent: 0 });
      const filename = `T3-Code-${version}-arm64.zip`;
      const base = `${this.source}/v${version}`;
      const checksums = await fetch(`${base}/SHA256SUMS`, { signal: AbortSignal.timeout(30_000) });
      if (!checksums.ok) throw new Error("Could not download Mac update checksums.");
      const expected = parseChecksums(await checksums.text()).get(filename);
      if (expected === undefined) throw new Error("This release has no Mac update archive.");
      const response = await fetch(`${base}/${filename}`, {
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (!response.ok || response.body === null)
        throw new Error("Could not download the Mac update archive.");
      const archive = NodePath.join(staging, "update.zip");
      await NodeStreamPromises.pipeline(
        NodeStream.Readable.from(response.body),
        NodeFS.createWriteStream(archive),
      );
      const hash = NodeCrypto.createHash("sha256");
      for await (const chunk of NodeFS.createReadStream(archive)) hash.update(chunk);
      verifyMacUpdateChecksum(hash.digest(), expected);
      const extracted = NodePath.join(staging, "extracted");
      await run("/usr/bin/ditto", ["-x", "-k", archive, extracted]);
      const bundles = (await NodeFSP.readdir(extracted)).filter((name) => name.endsWith(".app"));
      if (bundles.length !== 1) throw new Error("The update must contain one app bundle.");
      const bundle = NodePath.join(extracted, bundles[0]!);
      const plist = NodePath.join(bundle, "Contents/Info.plist");
      const { stdout: bundleId } = await run("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :CFBundleIdentifier",
        plist,
      ]);
      const { stdout: currentId } = await run("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :CFBundleIdentifier",
        NodePath.join(target, "Contents/Info.plist"),
      ]);
      const manifest: unknown = JSON.parse(
        await NodeFSP.readFile(
          NodePath.join(bundle, "Contents/Resources/app.asar/package.json"),
          "utf8",
        ),
      );
      if (
        bundleId.trim() !== currentId.trim() ||
        typeof manifest !== "object" ||
        manifest === null ||
        !("version" in manifest) ||
        manifest.version !== version
      )
        throw new Error("The update bundle identity or version does not match.");
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
      await NodeFSP.rm(archive);
      if (this.stagedBundle !== undefined)
        await NodeFSP.rm(NodePath.resolve(this.stagedBundle, "../.."), {
          recursive: true,
          force: true,
        });
      this.stagedBundle = bundle;
      this.emit("download-progress", { percent: 100 });
      this.emit("update-downloaded", { version });
    } catch (error) {
      await NodeFSP.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  private install(relaunch: boolean): void {
    if (this.stagedBundle === undefined || this.installing) return;
    const target = NodePath.resolve(process.execPath, "../../..");
    const backup = `${target}.t3-backup-${process.pid}`;
    const child = NodeChildProcess.spawn(
      "/bin/sh",
      [
        "-c",
        macUpdateInstallScript(),
        "t3-update",
        String(process.pid),
        this.stagedBundle,
        target,
        backup,
        relaunch ? "1" : "0",
      ],
      { detached: true, stdio: "ignore", cwd: "/" },
    );
    child.on("error", (error) => {
      this.installing = false;
      this.emit("error", error);
    });
    child.unref();
    this.installing = true;
  }

  quitAndInstall(_silent: boolean, relaunch: boolean): void {
    this.install(relaunch);
    app.quit();
  }
}
