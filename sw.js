const cacheName = "timeblock-reality-v9-pages-bridge";
const assets = [
  "./?v=20260712-pages-bridge",
  "index.html?v=20260712-pages-bridge",
  "manifest.webmanifest?v=20260712-pages-bridge",
  "icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const isDocument = request.mode === "navigate";
  const isVersionedAsset = new URL(request.url).searchParams.has("v");

  if (isDocument || isVersionedAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
