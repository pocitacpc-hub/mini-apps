const scope = self.registration.scope;
const cachePrefix = "mini-apps:" + scope;
const cacheName = cachePrefix + "v1";
const staticFiles = new Map([
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/mini-apps-180.png",
  "icons/mini-apps-192.png",
  "icons/mini-apps-512.png",
  "shared/shell.css",
  "shared/hub.js",
  "shared/pwa.js",
  "apps/apps.json",
  "apps/prevody/",
  "apps/prevody/index.html",
  "apps/prevody/app.css",
  "apps/prevody/app.js",
  "apps/prevody/data.json",
  "apps/neptun/",
  "apps/neptun/index.html",
  "apps/neptunWithSale/",
  "apps/neptunWithSale/index.html",
].map(path => {
  const url = new URL(path, scope);
  return [url.pathname, url.href];
}));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...staticFiles.values()].map(url => new Request(url, { cache: "reload" })));
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(cachePrefix) && key !== cacheName)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  const cacheKey = staticFiles.get(url.pathname);
  if (request.method !== "GET" || url.origin !== self.location.origin || !cacheKey) return;
  event.respondWith(networkFirst(request, cacheKey));
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(cacheName);
  let response;
  try {
    response = await fetch(request);
  } catch {
    return await cache.match(cacheKey) || Response.error();
  }

  if (response.ok) {
    try {
      await cache.put(cacheKey, response.clone());
    } catch (error) {
      console.warn("Mini Apps nemohly uložit soubor pro offline režim.", error);
    }
  } else if (response.status >= 500) {
    return await cache.match(cacheKey) || response;
  }
  return response;
}
