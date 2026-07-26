/** Register service worker (production / HTTPS only in practice). */
export async function registerServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  // Allow localhost + production
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    return Boolean(reg);
  } catch {
    return false;
  }
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

/** Call once at app boot. */
export function listenForInstallPrompt() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function canInstallPwa(): boolean {
  return deferred != null;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)").matches;
  // iOS Safari
  const ios = "standalone" in navigator && (navigator as { standalone?: boolean }).standalone;
  return mq || Boolean(ios);
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  const ev = deferred;
  deferred = null;
  notify();
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  return outcome;
}

export function onInstallAvailability(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
