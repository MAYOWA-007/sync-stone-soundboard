const CACHE_PREFIX = "sync-stone-soundboard-public-shell-";
const SHELL_VERSION = "0.2.0";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./sync-stone-mark.svg",
  "./assets/icons/sync-stone-180.png",
  "./assets/icons/sync-stone-192.png",
  "./assets/icons/sync-stone-512.png",
  "./js/app.js",
  "./js/core.js",
  "./js/storage.js",
  "./js/audio-engine.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => notifyClients("sync-stone.shell-active"))
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "sync-stone.shell-version.request") {
    event.source?.postMessage({ type: "sync-stone.shell-version", version: SHELL_VERSION });
  }
  if (event.data?.type === "sync-stone.skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") return cache.match("./index.html");
        return Response.error();
      })
  );
});

async function notifyClients(type) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type, version: SHELL_VERSION });
}
