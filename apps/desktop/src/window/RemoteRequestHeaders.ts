import * as NetAddress from "effect/net/NetAddress";
import * as Result from "effect/Result";
import type * as Electron from "electron";

// `*://` matches only http and https, so WebSocket schemes are listed separately.
const REMOTE_REQUEST_URL_PATTERNS = ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"];

export interface MainWindowRequestHeaderPolicy {
  readonly desktopOrigin: string;
  readonly mainWebContentsId: number;
  readonly clerkFrontendApiHostname?: string | undefined;
  readonly devServerOrigin?: string | undefined;
  readonly isDevelopment: boolean;
}

export interface MainWindowRequestHeaderDetails {
  readonly url: string;
  readonly webContentsId?: number | undefined;
  readonly frame?: { readonly parent: unknown } | null | undefined;
  readonly requestHeaders: Record<string, string>;
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    Result.match(NetAddress.ipFromString(hostname), {
      onSuccess: NetAddress.isLoopback,
      onFailure: () => false,
    })
  );
}

function toHttpOrigin(url: URL): string {
  if (url.protocol === "ws:") {
    return `http://${url.host}`;
  }
  if (url.protocol === "wss:") {
    return `https://${url.host}`;
  }
  return url.origin;
}

function isSubframe(details: MainWindowRequestHeaderDetails): boolean {
  try {
    return details.frame != null && details.frame.parent !== null;
  } catch {
    return true;
  }
}

function hasExactDesktopOriginHeader(
  requestHeaders: Record<string, string>,
  desktopOrigin: string,
): boolean {
  let matched = false;
  for (const [name, value] of Object.entries(requestHeaders)) {
    if (name.toLowerCase() !== "origin") continue;
    if (value !== desktopOrigin) return false;
    matched = true;
  }
  return matched;
}

function shouldPreserveOriginHeader(policy: MainWindowRequestHeaderPolicy, url: URL): boolean {
  const hostname = normalizeHostname(url.hostname);
  if (
    policy.clerkFrontendApiHostname !== undefined &&
    hostname === normalizeHostname(policy.clerkFrontendApiHostname)
  ) {
    return true;
  }
  if (!policy.isDevelopment) return false;
  if (policy.devServerOrigin !== undefined && toHttpOrigin(url) === policy.devServerOrigin) {
    return true;
  }
  return isLoopbackHostname(hostname);
}

/**
 * Strips Electron's synthetic `Origin` (`t3code://app`) and `Sec-Fetch-*` headers on outbound
 * main-window requests so origin-checking reverse proxies treat Desktop like native T3 clients.
 */
export function stripDesktopOriginHeaders(
  policy: MainWindowRequestHeaderPolicy,
  details: MainWindowRequestHeaderDetails,
): Record<string, string> | undefined {
  if (details.webContentsId !== policy.mainWebContentsId) return undefined;
  if (isSubframe(details)) return undefined;
  if (!hasExactDesktopOriginHeader(details.requestHeaders, policy.desktopOrigin)) {
    return undefined;
  }

  const parsedUrl = URL.parse(details.url);
  if (parsedUrl === null || shouldPreserveOriginHeader(policy, parsedUrl)) {
    return undefined;
  }

  const nextHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(details.requestHeaders)) {
    const lowerName = name.toLowerCase();
    if (lowerName === "origin" || lowerName.startsWith("sec-fetch-")) continue;
    nextHeaders[name] = value;
  }
  return nextHeaders;
}

const policiesByWebRequest = new WeakMap<
  Electron.WebRequest,
  Map<number, MainWindowRequestHeaderPolicy>
>();

export function installMainWindowRemoteRequestHeaderPolicy(
  session: Pick<Electron.Session, "webRequest">,
  policy: MainWindowRequestHeaderPolicy,
): () => void {
  const { webRequest } = session;
  let policies = policiesByWebRequest.get(webRequest);
  if (policies === undefined) {
    policies = new Map();
    const activePolicies = policies;
    policiesByWebRequest.set(webRequest, activePolicies);
    // Electron allows only one listener for this event per session.
    webRequest.onBeforeSendHeaders({ urls: REMOTE_REQUEST_URL_PATTERNS }, (details, callback) => {
      const requestPolicy = activePolicies.get(details.webContentsId ?? -1);
      const requestHeaders =
        requestPolicy === undefined ? undefined : stripDesktopOriginHeaders(requestPolicy, details);
      callback(requestHeaders === undefined ? {} : { requestHeaders });
    });
  }
  policies.set(policy.mainWebContentsId, policy);
  const activePolicies = policies;
  return () => {
    if (activePolicies.get(policy.mainWebContentsId) !== policy) return;
    activePolicies.delete(policy.mainWebContentsId);
    if (activePolicies.size === 0) {
      policiesByWebRequest.delete(webRequest);
      webRequest.onBeforeSendHeaders(null);
    }
  };
}
