const cacheName = "timeblock-reality-v20-background-push";
const assets = [
  "./?v=20260721-background-push",
  "index.html?v=20260721-background-push",
  "manifest.webmanifest?v=20260721-background-push",
  "push-config.js?v=20260721-background-push",
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

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const tasks = [
    self.registration.showNotification(data.title || "TimeBlock check-in", {
      body: data.body || "Continue, switch, or end this block.",
      icon: "icon.svg",
      tag: data.tag,
      data: data.data || {},
      renotify: true,
    }),
  ];
  if ("setAppBadge" in self.navigator && Number.isFinite(Number(data.badge))) {
    tasks.push(self.navigator.setAppBadge(Number(data.badge)));
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow("./?v=20260721-background-push");
    }),
  );
});
