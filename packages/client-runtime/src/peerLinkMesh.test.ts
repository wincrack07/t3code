import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type PeerLinkSummary } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  meshDestinationUrls,
  peerMeshFailure,
  planPeerLinks,
  type MeshMachine,
} from "./peerLinkMesh.ts";

const now = DateTime.makeUnsafe("2026-11-11T00:00:00Z");
const a = EnvironmentId.make("a");
const b = EnvironmentId.make("b");
const c = EnvironmentId.make("c");
const machines: ReadonlyArray<MeshMachine> = [a, b, c].map((environmentId) => ({
  environmentId,
  label: environmentId,
  renewable: true,
  urls: ["https://box.ts.net/"],
}));
const link = (environmentId = b): PeerLinkSummary => ({
  environmentId,
  label: environmentId,
  access: "auto",
  linkedAt: DateTime.subtract(now, { days: 26 }),
  expiresAt: DateTime.add(now, { days: 4 }),
  lastReachedAt: now,
  lastError: null,
  status: "reachable",
  urls: [],
});

describe("peer link mesh", () => {
  it("plans ordered pairs, keeps fresh links, and never treats a failed source read as empty", () => {
    const input = {
      machines,
      links: new Map([
        [a, [link()]],
        [b, []],
        [c, []],
      ]),
      now,
      automatic: false,
      managed: [],
      access: "auto" as const,
    };
    expect(planPeerLinks(input)).toHaveLength(6);
    expect(
      planPeerLinks({ ...input, links: new Map([[a, [{ ...link(), lastError: "Revoked" }]]]) })[0],
    ).toMatchObject({ renewExisting: false });
    const fresh = { ...link(), expiresAt: DateTime.add(now, { days: 6 }) };
    const planned = planPeerLinks({
      ...input,
      links: new Map([
        [a, [fresh]],
        [b, []],
      ]),
    });
    expect(
      planned.map((pair) => [pair.source.environmentId, pair.destination.environmentId]),
    ).toEqual([
      [a, c],
      [b, a],
      [b, c],
    ]);
    expect(planPeerLinks({ ...input, machines: [machines[0]!] })).toEqual([]);
  });

  it("automatically renews only the same active managed link at its original access", () => {
    const current = link();
    const input = {
      machines,
      links: new Map([[a, [current]]]),
      now,
      automatic: true,
      managed: [
        {
          source: a,
          destination: b,
          linkedAt: DateTime.formatIso(current.linkedAt),
          access: "auto" as const,
        },
      ],
      access: "full-access" as const,
    };
    expect(planPeerLinks(input)).toMatchObject([{ access: "auto", renewExisting: true }]);
    expect(
      planPeerLinks({
        ...input,
        links: new Map([[a, [{ ...current, lastError: "An earlier network request failed" }]]]),
      }),
    ).toMatchObject([{ access: "auto", renewExisting: true }]);
    for (const changed of [
      undefined,
      { ...current, status: "expired" as const, expiresAt: now },
      { ...current, status: "unreachable" as const },
      { ...current, linkedAt: now },
      { ...current, access: "read-only" as const },
    ]) {
      expect(planPeerLinks({ ...input, links: new Map([[a, changed ? [changed] : []]]) })).toEqual(
        [],
      );
    }
    expect(
      planPeerLinks({
        ...input,
        machines: machines.map((machine) => ({ ...machine, renewable: false })),
      }),
    ).toEqual([]);
    expect(
      planPeerLinks({
        ...input,
        machines: machines.filter((machine) => machine.environmentId !== b),
      }),
    ).toEqual([]);
    expect(planPeerLinks({ ...input, managed: [] })).toEqual([]);
  });

  it("explains loopback-only destinations and preserves real policy errors", () => {
    expect(() =>
      meshDestinationUrls({
        ...machines[0]!,
        label: "Mac",
        urls: ["http://127.0.0.1:3773", "http://[::1]:3773"],
      }),
    ).toThrow(
      "Mac has no address another machine can reach. Enable network access or Tailscale Serve",
    );
    expect(
      meshDestinationUrls({
        ...machines[0]!,
        urls: ["http://localhost:3773", "http://100.84.251.28:3773"],
      }),
    ).toEqual(["http://100.84.251.28:3773"]);
    expect(peerMeshFailure(new Error("100.84.251.28 refused: not on this tailnet"))).toBe(
      "100.84.251.28 refused: not on this tailnet",
    );
    expect(peerMeshFailure(null)).toContain("sessions can manage access");
  });
});
