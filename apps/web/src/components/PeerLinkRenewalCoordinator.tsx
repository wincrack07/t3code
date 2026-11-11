import { useEffect } from "react";
import { runPeerMesh, usePeerMeshSettings } from "~/state/peerLinkMesh";

export function PeerLinkRenewalCoordinator() {
  const [settings] = usePeerMeshSettings();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- renew owned links while this broker is open, including after waking from sleep
  useEffect(() => {
    if (!settings.enabled) return;
    const renew = () => {
      void runPeerMesh(true);
    };
    renew();
    const timer = window.setInterval(renew, 60 * 60 * 1000);
    window.addEventListener("online", renew);
    const onVisibility = () => {
      if (document.visibilityState === "visible") renew();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", renew);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [settings.enabled]);
  return null;
}
