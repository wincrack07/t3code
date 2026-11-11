import type { MachineProcess } from "@t3tools/contracts";

export function linuxMemory(text: string) {
  const values = new Map(
    [...text.matchAll(/^(\w+):\s+(\d+) kB/gm)].map((m) => [m[1], Number(m[2]) * 1024]),
  );
  const total = values.get("MemTotal");
  const available = values.get("MemAvailable");
  if (total === undefined || available === undefined) throw new Error("Missing memory counters");
  return {
    total,
    available: Math.min(total, available),
    swapTotal: values.get("SwapTotal") ?? null,
    swapUsed:
      values.has("SwapTotal") && values.has("SwapFree")
        ? values.get("SwapTotal")! - values.get("SwapFree")!
        : null,
  };
}

export function macMemory(text: string, total: number) {
  const size = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = (key: string) => {
    const match = new RegExp(`^${key}:\\s+(\\d+)\\.`, "m").exec(text);
    if (!match) throw new Error("Missing vm_stat counter");
    return Number(match[1]);
  };
  if (!(size > 0)) throw new Error("Missing page size");
  return Math.min(
    total,
    (pages("Pages free") +
      pages("Pages speculative") +
      pages("File-backed pages") +
      pages("Pages purgeable")) *
      size,
  );
}

export function macSwap(text: string) {
  const bytes = (key: string) => {
    const m = new RegExp(`${key} = ([\\d.]+)([MG])`).exec(text);
    return m ? Number(m[1]) * (m[2] === "G" ? 1024 ** 3 : 1024 ** 2) : null;
  };
  return { swapUsed: bytes("used"), swapTotal: bytes("total") };
}

export function linuxNetwork(text: string): [number, number] {
  let down = 0,
    up = 0;
  for (const line of text.split("\n")) {
    const m = /^\s*([^:]+):\s*(.*)/.exec(line);
    if (!m || m[1] === "lo") continue;
    const values = m[2]!.trim().split(/\s+/).map(Number);
    down += values[0] ?? 0;
    up += values[8] ?? 0;
  }
  return [down, up];
}

export function macNetwork(text: string): [number, number] {
  const rows = text
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/));
  const header = rows.shift() ?? [];
  const seen = new Set<string>();
  let down = 0,
    up = 0;
  for (const row of rows) {
    const name = row[0] ?? "";
    if (name.startsWith("lo") || seen.has(name) || !row[2]?.startsWith("<Link#")) continue;
    const offset = Math.min(0, row.length - header.length);
    const rx = Number(row[header.indexOf("Ibytes") + offset]),
      tx = Number(row[header.indexOf("Obytes") + offset]);
    if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
    seen.add(name);
    down += rx;
    up += tx;
  }
  return [down, up];
}

export function macProcesses(text: string): MachineProcess[] {
  return text.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m) return [];
    const command = m[5]!;
    return [
      {
        pid: Number(m[1]),
        ppid: Number(m[2]),
        cpu: Number(m[3]),
        rss: Number(m[4]) * 1024,
        name: command.split("/").pop()!.slice(0, 120),
        owner: /\/([^/]+)\.app\//.exec(command)?.[1] ?? null,
        cwd: null,
      },
    ];
  });
}

export function linuxProcess(text: string) {
  const end = text.lastIndexOf(")");
  const fields = text.slice(end + 2).split(/\s+/);
  return {
    name: text.slice(text.indexOf("(") + 1, end),
    ppid: Number(fields[1]),
    ticks: Number(fields[11]) + Number(fields[12]),
    start: fields[19],
    rssPages: Number(fields[21]),
  };
}

export function pressure(available: number, total: number, psi: string, macLevel?: string) {
  if (macLevel !== undefined)
    return (
      ({ "1": "normal", "2": "warning", "4": "critical" } as const)[
        macLevel.trim() as "1" | "2" | "4"
      ] ?? "unknown"
    );
  const stall = Number(/^full avg10=([\d.]+)/m.exec(psi)?.[1] ?? 0);
  return stall >= 10 || available / total < 0.05
    ? "critical"
    : stall >= 1 || available / total < 0.1
      ? "warning"
      : "normal";
}

export function macCwds(text: string) {
  const result = new Map<number, string>();
  let pid: number | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n/") && pid !== undefined) result.set(pid, line.slice(1));
  }
  return result;
}

export function attributeProjects(
  processes: readonly MachineProcess[],
  roots: readonly { id: string; title: string; path: string }[],
) {
  const totals = new Map<
    string,
    { id: string; title: string; rss: number; cpu: number; count: number }
  >();
  const ordered = [...roots].sort((a, b) => b.path.length - a.path.length);
  for (const p of processes) {
    const root = ordered.find(
      (root) => p.cwd === root.path || p.cwd?.startsWith(`${root.path.replace(/\/$/, "")}/`),
    );
    if (!root) continue;
    const group = totals.get(root.id) ?? {
      id: root.id,
      title: root.title,
      rss: 0,
      cpu: 0,
      count: 0,
    };
    group.rss += p.rss;
    group.cpu += p.cpu;
    group.count++;
    totals.set(root.id, group);
  }
  return [...totals.values()].sort((a, b) => b.rss - a.rss);
}
