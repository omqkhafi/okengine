/**
 * Unregister leftover service workers.
 *
 * localhost:3000 is shared across projects. A prior registration keeps
 * asking for /sw.js on every navigation; this file answers 200 and
 * drops the worker so the request stops.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
    })(),
  );
});
