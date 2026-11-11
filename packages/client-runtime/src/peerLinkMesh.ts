import type { AuthMcpClientAccess, EnvironmentId, PeerLinkSummary } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";

export interface ManagedPeerLink {
  readonly source: EnvironmentId;
  readonly destination: EnvironmentId;
  readonly access: AuthMcpClientAccess;
  readonly linkedAt: string;
}

export interface MeshMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly urls: ReadonlyArray<string>;
  readonly renewable: boolean;
}

export const meshPairKey = (source: EnvironmentId, destination: EnvironmentId) =>
  JSON.stringify([source, destination]);

export function planPeerLinks(input: {
  readonly machines: ReadonlyArray<MeshMachine>;
  readonly links: ReadonlyMap<EnvironmentId, ReadonlyArray<PeerLinkSummary>>;
  readonly now: DateTime.Utc;
  readonly automatic: boolean;
  readonly managed: ReadonlyArray<ManagedPeerLink>;
  readonly access: AuthMcpClientAccess;
}) {
  const warningAt = DateTime.add(input.now, { days: 5 });
  return input.machines.flatMap((source) => {
    const links = input.links.get(source.environmentId);
    // A failed read must never be treated as an empty list.
    if (links === undefined) return [];
    return input.machines.flatMap((destination) => {
      if (source.environmentId === destination.environmentId) return [];
      const link = links.find((candidate) => candidate.environmentId === destination.environmentId);
      if (link !== undefined && DateTime.isGreaterThan(link.expiresAt, warningAt)) return [];
      const managed = input.managed.find(
        (pair) =>
          pair.source === source.environmentId && pair.destination === destination.environmentId,
      );
      const active = link !== undefined && DateTime.isGreaterThan(link.expiresAt, input.now);
      if (
        input.automatic &&
        (!active ||
          link.status !== "reachable" ||
          managed === undefined ||
          managed.linkedAt !== DateTime.formatIso(link.linkedAt) ||
          managed.access !== link.access ||
          !source.renewable ||
          !destination.renewable)
      )
        return [];
      const access = input.automatic ? managed!.access : input.access;
      return [
        {
          source,
          destination,
          access,
          renewExisting:
            active &&
            (input.automatic || link.lastError === null) &&
            link.access === access &&
            source.renewable &&
            destination.renewable,
        },
      ];
    });
  });
}

export function meshDestinationUrls(machine: MeshMachine): ReadonlyArray<string> {
  const urls = machine.urls.filter((url) => {
    const parsed = URL.parse(url);
    return parsed !== null && !isLocalLoopbackHost(parsed.hostname);
  });
  if (urls.length === 0)
    throw new Error(
      `${machine.label} has no address another machine can reach. Enable network access or Tailscale Serve in its Connections settings, then retry.`,
    );
  return urls;
}

export function peerMeshFailure(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : typeof error === "string"
      ? error
      : "The environment request failed. Check that both machines are connected and your sessions can manage access.";
}
