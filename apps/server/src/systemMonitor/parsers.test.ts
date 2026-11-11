import { describe, expect, it } from "@effect/vitest";
import {
  attributeProjects,
  linuxMemory,
  linuxNetwork,
  linuxProcess,
  macCwds,
  macMemory,
  macNetwork,
  macProcesses,
  macSwap,
  pressure,
} from "./parsers.ts";
import { Ring } from "./history.ts";

// Representative command output, with machine-specific counts reduced for readable assertions.
const vm = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               100.
Pages active:                             500.
Pages inactive:                           200.
Pages speculative:                         10.
Pages wired down:                          50.
Pages purgeable:                           20.
File-backed pages:                        300.
Pages occupied by compressor:              30.`;

describe("machine counters", () => {
  it("uses XYZ Clean reclaimable accounting and the reported Apple Silicon page size", () => {
    expect(macMemory(vm, 1024 ** 3)).toBe(430 * 16384);
    expect(macMemory(vm.replace("16384", "4096"), 100)).toBe(100);
    expect(() => macMemory("", 100)).toThrow();
    expect(macSwap("total = 2048.00M  used = 1.00G  free = 1024.00M (encrypted)")).toEqual({
      swapTotal: 2 * 1024 ** 3,
      swapUsed: 1024 ** 3,
    });
    expect(macSwap("unavailable")).toEqual({ swapTotal: null, swapUsed: null });
    expect(pressure(50, 100, "", "2\n")).toBe("warning");
    expect(pressure(50, 100, "", "unknown")).toBe("unknown");
  });
  it("reads Linux MemAvailable, swap and PSI", () => {
    expect(
      linuxMemory("MemTotal: 100 kB\nMemAvailable: 40 kB\nSwapTotal: 20 kB\nSwapFree: 12 kB\n"),
    ).toEqual({ total: 102400, available: 40960, swapTotal: 20480, swapUsed: 8192 });
    expect(() => linuxMemory("MemFree: 20 kB\n")).toThrow();
    expect(pressure(50, 100, "some avg10=90.00 avg60=0.00\nfull avg10=12.00 avg60=0.00")).toBe(
      "critical",
    );
    expect(pressure(50, 100, "")).toBe("normal");
  });
  it("counts each network interface once and excludes loopback", () => {
    expect(linuxNetwork(" lo: 100 0 0 0 0 0 0 0 200 0\n eth0: 300 0 0 0 0 0 0 0 400 0")).toEqual([
      300, 400,
    ]);
    expect(
      macNetwork(`Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
lo0 16384 <Link#1> 00:00 10 0 900 10 0 900 0
en0 1500 <Link#4> ab:cd 10 0 1000 20 0 2000 0
en0 1500 192.168.1 192.168.1.2 10 - 1000 20 - 2000 -`),
    ).toEqual([1000, 2000]);
  });
  it("parses macOS processes without truncating multicore CPU and cwd paths with spaces", () => {
    const [p] = macProcesses(
      " 123 1 230.5 2048 /Applications/Example App.app/Contents/MacOS/Example\n",
    );
    expect(p).toMatchObject({
      pid: 123,
      cpu: 230.5,
      rss: 2097152,
      owner: "Example App",
      name: "Example",
    });
    expect(macCwds("p123\nfcwd\nn/work/my project\n").get(123)).toBe("/work/my project");
    expect(macProcesses("permission denied")).toEqual([]);
  });
  it("parses Linux comm containing spaces and parentheses", () => {
    const fields = Array.from({ length: 22 }, () => "0");
    fields[0] = "S";
    fields[1] = "42";
    fields[11] = "100";
    fields[12] = "20";
    fields[19] = "456";
    fields[21] = "99";
    expect(linuxProcess(`123 (a (worker)) ${fields.join(" ")}`)).toMatchObject({
      name: "a (worker)",
      ppid: 42,
      ticks: 120,
      start: "456",
      rssPages: 99,
    });
  });
  it("attributes only bounded cwd descendants, picks nested projects and counts worktrees once", () => {
    const process = {
      pid: 1,
      ppid: 0,
      name: "node",
      rss: 100,
      cpu: 150,
      owner: null,
      cwd: "/repo/app/src",
    };
    const roots = [
      { id: "a", title: "A", path: "/repo" },
      { id: "b", title: "B", path: "/repo/app" },
      { id: "a", title: "A", path: "/worktree" },
    ];
    expect(
      attributeProjects(
        [
          process,
          { ...process, pid: 2, cwd: "/worktree" },
          { ...process, pid: 3, cwd: "/repository" },
        ],
        roots,
      ),
    ).toEqual([
      { id: "b", title: "B", rss: 100, cpu: 150, count: 1 },
      { id: "a", title: "A", rss: 100, cpu: 150, count: 1 },
    ]);
  });
  it("retains chronological bounded history after multiple wraps", () => {
    const ring = new Ring<number>(3);
    expect(ring.read()).toEqual([]);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) ring.append(n);
    expect(ring.read()).toEqual([5, 6, 7]);
    expect(() => new Ring(0)).toThrow();
  });
});
