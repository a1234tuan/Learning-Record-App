const NATIVE_SW_RELOAD_KEY = "native-sw-cleanup-v1";

const isPwaCache = (name: string): boolean =>
  /^(?:workbox-|precache-|vite-pwa-|pwa-)/i.test(name);

const readReloadMarker = (): boolean => {
  try {
    return window.sessionStorage.getItem(NATIVE_SW_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
};

const writeReloadMarker = (): void => {
  try {
    window.sessionStorage.setItem(NATIVE_SW_RELOAD_KEY, "1");
  } catch {
    // Session storage can be unavailable in restricted WebViews.
  }
};

/** Remove PWA registrations/caches from Capacitor without touching app data. */
export const cleanupNativeServiceWorker = async (): Promise<boolean> => {
  if (typeof window === "undefined" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }

  let hadController = Boolean(navigator.serviceWorker.controller);
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      hadController ||= Boolean(registration.active === navigator.serviceWorker.controller);
      await registration.unregister();
    }
  } catch {
    // A WebView may expose the API but reject registration access.
  }

  try {
    if (typeof caches !== "undefined") {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.filter(isPwaCache).map((name) => caches.delete(name)));
    }
  } catch {
    // Cache Storage cleanup is best effort and never blocks the editor.
  }

  if (hadController && !readReloadMarker()) {
    writeReloadMarker();
    return true;
  }
  return false;
};
