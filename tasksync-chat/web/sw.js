// TaskSync Remote - Service Worker
const CACHE_NAME = "tasksync-remote-v5";
const STATIC_ASSETS = [
	"./",
	"./index.html",
	"./offline.html",
	"./login.css",
	"./login.js",
	"./shared-constants.js",
	"./manifest.json",
	"./icons/icon-192.svg",
	"./icons/icon-512.svg",
];

// Install
self.addEventListener("install", (e) => {
	e.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
	);
	self.skipWaiting();
});

// Activate
self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
				),
			),
	);
	self.clients.claim();
});

// Fetch - Network first, fallback to cache (static assets only)
self.addEventListener("fetch", (e) => {
	// Skip non-http(s) URLs (e.g., chrome-extension://, blob:, data:)
	if (
		!e.request.url.startsWith("http://") &&
		!e.request.url.startsWith("https://")
	) {
		return;
	}
	// Skip WebSocket requests
	if (e.request.url.includes("ws://") || e.request.url.includes("wss://")) {
		return;
	}

	const url = new URL(e.request.url);

	// Don't cache API responses (may contain sensitive data)
	if (url.pathname.startsWith("/api/")) {
		e.respondWith(fetch(e.request));
		return;
	}

	const normalizedStaticAssets = STATIC_ASSETS.map((asset) =>
		asset.replace(/^\.\//, ""),
	)
		.filter((asset) => asset.length > 0)
		.map((asset) => "/" + asset.replace(/^\/+/, ""));
	const trustedStaticPaths = new Set(normalizedStaticAssets);
	const isPrecachedStaticAsset = trustedStaticPaths.has(url.pathname);

	// Don't cache JS files at runtime — only precached static assets in STATIC_ASSETS
	// are trusted. This prevents caching potentially tampered scripts over HTTP.
	if (url.pathname.endsWith(".js") && !isPrecachedStaticAsset) {
		e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
		return;
	}

	e.respondWith(
		fetch(e.request)
			.then((response) => {
				// Clone and cache successful responses
				if (response.ok) {
					const clone = response.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
				}
				return response;
			})
			.catch(() =>
				caches.match(e.request).then((cached) => {
					if (cached) return cached;
					// For navigation requests, show offline page
					if (e.request.mode === "navigate") {
						return caches.match("./offline.html");
					}
					return cached; // undefined — browser default error
				}),
			),
	);
});
