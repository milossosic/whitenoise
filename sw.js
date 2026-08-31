const CACHE = "noise-v24";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./sounds/white.wav",
  "./sounds/brown.wav",
  "./sounds/pink.wav",
  "./sounds/fan.wav",
  "./sounds/soft.wav",
  "./sounds/ac.wav",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./favicon.svg",
  "./favicon-32.png",
  "./apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        ASSETS.map((url) =>
          fetch(url, { cache: "reload" }).then((response) => {
            if (!response.ok) throw new Error(`cache ${url}: ${response.status}`);
            return cache.put(url, response);
          }),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    }),
  );
});
