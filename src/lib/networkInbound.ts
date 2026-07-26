/** North Network deep-link intake for Grok Assistant */

export const HUBLIFE_URL =
  (import.meta.env.VITE_HUBLIFE_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://hublife.ca";

export type NetworkInbound = {
  fromNetwork: boolean;
  via: string | null;
  intent: string | null;
  campaign: string | null;
};

export function parseNetworkInbound(
  search = typeof window !== "undefined" ? window.location.search : "",
): NetworkInbound {
  const sp = new URLSearchParams(search);
  const from = sp.get("from");
  return {
    fromNetwork: from === "network" || from === "hublife",
    via: sp.get("via"),
    intent: sp.get("intent"),
    campaign: sp.get("utm_campaign"),
  };
}

export function hubLifeHomeUrl(via = "grok"): string {
  const u = new URL(HUBLIFE_URL);
  u.searchParams.set("from", "network");
  u.searchParams.set("via", via);
  u.searchParams.set("utm_source", "north_network");
  u.searchParams.set("utm_medium", "cross_app");
  u.searchParams.set("utm_campaign", "grok_home");
  return u.toString();
}

/** Strip network params from the address bar after handling (keeps share clean). */
export function clearNetworkParamsFromUrl() {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    ["from", "via", "intent", "utm_source", "utm_medium", "utm_campaign"].forEach(
      (k) => u.searchParams.delete(k),
    );
    const next = u.pathname + (u.search ? u.search : "") + u.hash;
    window.history.replaceState({}, "", next || "/");
  } catch {
    /* ignore */
  }
}
