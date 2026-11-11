import { linkableMachines, offersLinkedEnvironments } from "@t3tools/client-runtime/link-request";
import {
  meshDestinationUrls,
  meshPairKey,
  peerMeshFailure,
  planPeerLinks,
  type ManagedPeerLink,
  type MeshMachine,
} from "@t3tools/client-runtime/peer-link-mesh";
import {
  createEnvironmentRpcCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthMcpClientAccess,
  EnvironmentId,
  WS_METHODS,
  type PeerLinkSummary,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  readLocalStorageValue,
  writeLocalStorageValue,
  useLocalStorage,
} from "../hooks/useLocalStorage";
import { environmentPresentations } from "./presentation";
import { relayEnvironmentDiscovery } from "./relay";
import { peerLinkEnvironment } from "./peerLinks";
import { mintPairingCodeOn } from "./peerPairingCode";

const MeshSettings = Schema.Struct({
  enabled: Schema.Boolean,
  managed: Schema.Array(
    Schema.Struct({
      source: EnvironmentId,
      destination: EnvironmentId,
      access: AuthMcpClientAccess,
      linkedAt: Schema.String,
    }),
  ),
});
const storageKey = "t3code:peer-link-mesh:v1";
const initial = { enabled: false, managed: [] };
const readSettings = () => readLocalStorageValue(storageKey, initial, MeshSettings);
export const usePeerMeshSettings = () => useLocalStorage(storageKey, initial, MeshSettings);
const list = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "peer-mesh:list",
  tag: WS_METHODS.peerLinksList,
});

export const peerMeshProgressAtom = Atom.make<
  ReadonlyArray<{ readonly key: string; readonly label: string; readonly status: string }>
>([]);
export const peerMeshBusyAtom = Atom.make(false);

export const peerMeshPermissionsAtom = Atom.make((get) => {
  const hosts = [...get(environmentPresentations.presentationsAtom)].filter(
    ([, environment]) =>
      environment.connection.phase === "connected" &&
      environment.serverConfig?.environment.capabilities.peerLinks === true,
  );
  const linkHosts = hosts.filter(([, environment]) =>
    offersLinkedEnvironments(environment.serverConfig),
  );
  return {
    link:
      linkHosts.length >= 2 &&
      linkHosts.every(([id]) => get(peerLinkEnvironment.link.permissionAtom(id))),
    unlink:
      hosts.length > 0 && hosts.every(([id]) => get(peerLinkEnvironment.unlink.permissionAtom(id))),
  };
});

function machines(includeDisabled: boolean): ReadonlyArray<MeshMachine> {
  const environments = [...appAtomRegistry.get(environmentPresentations.presentationsAtom)].map(
    ([environmentId, presentation]) => ({ ...presentation, environmentId }),
  );
  const targets = linkableMachines({
    environments,
    threadEnvironmentId: EnvironmentId.make("mesh-broker"),
    links: [],
    connect: appAtomRegistry.get(relayEnvironmentDiscovery.stateValueAtom).environments,
  });
  return environments
    .filter(
      (environment) =>
        environment.connection.phase === "connected" &&
        environment.serverConfig?.environment.capabilities.peerLinks === true &&
        (includeDisabled || offersLinkedEnvironments(environment.serverConfig)),
    )
    .map((environment) => {
      const target = targets.find(
        (candidate) => candidate.environmentId === environment.environmentId,
      )!;
      return {
        environmentId: environment.environmentId,
        label: target.label,
        urls: target.urls,
        renewable: environment.serverConfig?.environment.capabilities.peerLinkRenewal === true,
      };
    });
}

async function runMesh(automatic: boolean, access: AuthMcpClientAccess, unlink: boolean) {
  if (appAtomRegistry.get(peerMeshBusyAtom)) return;
  appAtomRegistry.set(peerMeshBusyAtom, true);
  appAtomRegistry.set(peerMeshProgressAtom, []);
  const progress = (key: string, label: string, status: string) =>
    appAtomRegistry.update(peerMeshProgressAtom, (rows) => [
      ...rows.filter((row) => row.key !== key),
      { key, label, status },
    ]);
  try {
    if (unlink)
      writeLocalStorageValue(storageKey, { enabled: false, managed: [] }, initial, MeshSettings);
    const settings = readSettings();
    if (automatic && !settings.enabled) return;
    const known = machines(unlink);
    const links = new Map<EnvironmentId, ReadonlyArray<PeerLinkSummary>>();
    for (const machine of known) {
      const result = await list.run(appAtomRegistry, {
        environmentId: machine.environmentId,
        input: {},
      });
      if (result._tag === "Success") links.set(machine.environmentId, result.value.links);
      else
        progress(
          machine.environmentId,
          machine.label,
          peerMeshFailure(squashAtomCommandFailure(result)),
        );
    }
    if (unlink) {
      const ids = new Set(known.map((machine) => machine.environmentId));
      for (const [source, outgoing] of links)
        for (const link of outgoing) {
          if (!ids.has(link.environmentId)) continue;
          const key = meshPairKey(source, link.environmentId);
          const label = `${known.find((machine) => machine.environmentId === source)!.label} → ${link.label}`;
          const result = await peerLinkEnvironment.unlink.run(appAtomRegistry, {
            environmentId: source,
            input: { environmentId: link.environmentId },
          });
          progress(
            key,
            label,
            result._tag === "Success"
              ? "Unlinked"
              : peerMeshFailure(squashAtomCommandFailure(result)),
          );
        }
      return;
    }
    const plan = planPeerLinks({
      machines: known,
      links,
      now: DateTime.makeUnsafe(Date.now()),
      automatic,
      managed: settings.managed,
      access,
    });
    for (const pair of plan) {
      if (automatic && !readSettings().enabled) break;
      const key = meshPairKey(pair.source.environmentId, pair.destination.environmentId);
      const label = `${pair.source.label} → ${pair.destination.label}`;
      progress(key, label, pair.renewExisting ? "Renewing…" : "Linking…");
      try {
        const [url, ...alternateUrls] = meshDestinationUrls(pair.destination);
        if (url === undefined) continue;
        const minted = await mintPairingCodeOn(pair.destination.environmentId, pair.access);
        if (Result.isFailure(minted)) throw minted.failure;
        const result = await peerLinkEnvironment.link.run(appAtomRegistry, {
          environmentId: pair.source.environmentId,
          input: {
            url,
            alternateUrls,
            expectedEnvironmentId: pair.destination.environmentId,
            expectedLabel: pair.destination.label,
            pairingCode: minted.success,
            access: pair.access,
            renewExisting: pair.renewExisting,
          },
        });
        if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        const managed: ManagedPeerLink = {
          source: pair.source.environmentId,
          destination: pair.destination.environmentId,
          access: pair.access,
          linkedAt: DateTime.formatIso(result.value.linkedAt),
        };
        writeLocalStorageValue(
          storageKey,
          (current) => ({
            ...current,
            managed: [
              ...current.managed.filter(
                (item) => meshPairKey(item.source, item.destination) !== key,
              ),
              managed,
            ],
          }),
          initial,
          MeshSettings,
        );
        progress(key, label, pair.renewExisting ? "Renewed" : "Linked");
      } catch (error) {
        progress(key, label, peerMeshFailure(error));
      }
    }
    if (plan.length === 0 && links.size === known.length)
      progress("complete", "All connected environments", "No links need linking or renewal.");
  } catch (error) {
    progress("broker", "Linking environments", peerMeshFailure(error));
  } finally {
    appAtomRegistry.set(peerMeshBusyAtom, false);
  }
}

export async function runPeerMesh(
  automatic = false,
  access: AuthMcpClientAccess = "approval-required",
  unlink = false,
) {
  // The same browser profile can have several tabs open; only one brokers renewal at a time.
  if (typeof navigator !== "undefined" && navigator.locks) {
    await navigator.locks.request(
      "t3code:peer-link-mesh",
      { ifAvailable: automatic },
      async (lock) => {
        if (lock) await runMesh(automatic, access, unlink);
      },
    );
  } else await runMesh(automatic, access, unlink);
}
