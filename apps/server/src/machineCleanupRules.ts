import type { MachineCleanupSettings } from "@t3tools/contracts";

export interface MachineCacheRule {
  readonly id: string;
  readonly relativePath: string;
  readonly phase: "A" | "C";
  readonly effect: string;
  readonly command?: readonly [string, ...string[]];
  readonly gradle?: boolean;
  readonly children?: boolean;
  readonly emptyOnly?: boolean;
  readonly filesOnly?: boolean;
}

export function machineCacheRules(platform: string): MachineCacheRule[] {
  if (platform !== "darwin" && platform !== "linux") return [];
  const common: MachineCacheRule[] = [
    {
      id: "npm",
      relativePath: ".npm",
      phase: "A",
      effect: "npm packages download again",
      command: ["npm", "cache", "clean", "--force"],
    },
    { id: "npx", relativePath: ".npm/_npx", phase: "A", effect: "npx packages download again" },
    {
      id: "pnpm-prune",
      relativePath: platform === "darwin" ? "Library/pnpm/store" : ".local/share/pnpm/store",
      phase: "A",
      effect: "Unused pnpm packages download again",
      command: ["pnpm", "store", "prune"],
    },
    ...["uv", "puppeteer"].map((name): MachineCacheRule => ({
      id: name,
      relativePath: `.cache/${name}`,
      phase: "A",
      effect: `${name} downloads again`,
    })),
    {
      id: "gradle",
      relativePath: ".gradle/caches",
      phase: "A",
      effect: "Next Android build downloads dependencies",
      gradle: true,
    },
    {
      id: "codex-empty",
      relativePath: ".codex/worktrees",
      phase: "A",
      effect: "Remove empty folders only",
      children: true,
      emptyOnly: true,
    },
    {
      id: "docker-build",
      relativePath: ".docker",
      phase: "C",
      effect: "Docker build cache is lost; images and containers remain",
      command: ["docker", "builder", "prune", "-af"],
    },
    {
      id: "pnpm-full",
      relativePath: platform === "darwin" ? "Library/pnpm/store" : ".local/share/pnpm/store",
      phase: "C",
      effect: "Next install downloads every package",
    },
    {
      id: "gradle-full",
      relativePath: ".gradle/caches",
      phase: "C",
      effect:
        "Stop Gradle daemons; Android builds must be relaunched and dependencies download again",
      gradle: true,
    },
    {
      id: "pub-cache",
      relativePath: ".pub-cache",
      phase: "C",
      effect: "Flutter packages download again",
      command: ["flutter", "pub", "cache", "clean"],
    },
    {
      id: "android-avd",
      relativePath: ".android/avd",
      phase: "C",
      effect: "Android virtual devices and their data are lost",
    },
    {
      id: "playwright",
      relativePath: ".cache/ms-playwright",
      phase: "C",
      effect: "Playwright browsers must be downloaded again",
    },
  ];
  common.push({
    id: "android-sdk-images",
    relativePath:
      platform === "darwin" ? "Library/Android/sdk/system-images" : "Android/Sdk/system-images",
    phase: "C",
    effect: "Android emulator images must be downloaded again",
    children: true,
  });
  if (platform === "linux")
    return [
      ...common,
      ...["pnpm", "pip"].map((name): MachineCacheRule => ({
        id: `linux-${name}`,
        relativePath: `.cache/${name}`,
        phase: "A",
        effect: `${name} cache downloads again`,
      })),
    ];
  return [
    ...common,
    {
      id: "brew",
      relativePath: "Library/Caches/Homebrew",
      phase: "A",
      effect: "Homebrew cached downloads and old versions are removed",
      command: ["brew", "cleanup", "--prune=all", "-s"],
    },
    {
      id: "sim-unavailable",
      relativePath: "Library/Developer/CoreSimulator/Devices",
      phase: "A",
      effect: "Unavailable simulators removed",
      command: ["xcrun", "simctl", "delete", "unavailable"],
    },
    {
      id: "derived-data",
      relativePath: "Library/Developer/Xcode/DerivedData",
      phase: "A",
      effect: "Xcode builds again",
      children: true,
    },
    ...["pnpm", "org.swift.swiftpm", "CocoaPods", "pip", "go-build", "node-gyp"].map(
      (name): MachineCacheRule => ({
        id: `mac-${name}`,
        relativePath: `Library/Caches/${name}`,
        phase: "A",
        effect: `${name} cache downloads again`,
      }),
    ),
    {
      id: "code-vsix",
      relativePath: "Library/Application Support/Code/CachedExtensionVSIXs",
      phase: "A",
      effect: "VS Code extension packages download again",
    },
    {
      id: "simulator-data",
      relativePath: "Library/Developer/CoreSimulator/Devices",
      phase: "C",
      effect: "All simulator apps and data are lost",
      command: ["xcrun", "simctl", "erase", "all"],
    },
    {
      id: "xcode-archives",
      relativePath: "Library/Developer/Xcode/Archives",
      phase: "C",
      effect: "Archived app builds and debug symbols are lost",
    },
  ];
}

export const machineRuleEnabled = (settings: MachineCleanupSettings, rule: string) =>
  settings.enabledRules.includes("*") || settings.enabledRules.includes(rule);

export function cleanupMeasurementPath(platform: string, home: string) {
  return platform === "darwin" ? "/System/Volumes/Data" : home;
}

export function cleanupBuildProcesses(output: string) {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+([\d.,]+)\s+(.+)$/.exec(line);
    if (!match) return [];
    const command = match[3]!;
    const cpu = Number(match[2]!.replace(",", "."));
    if (
      !/(?:GradleDaemon|GradleWrapperMain|org\.gradle|\bxcodebuild\b|\bflutter\b.*\b(?:build|run)\b)/.test(
        command,
      )
    )
      return [];
    return [
      { pid: Number(match[1]), cpu, command, busy: !command.includes("GradleDaemon") || cpu > 1 },
    ];
  });
}
