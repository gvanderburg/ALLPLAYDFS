const CACHE_NAME = 'allplay-shell-v5';
const OWN_CACHE_PREFIXES = ['slate-one-', 'slatemetry-', 'dfsift-', 'allplay-'];
const APP_SHELL = ['/', '/manifest.webmanifest', '/slate-icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    const page = await cache.match('/');
    const html = page ? await page.text() : '';
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)]
      .map((match) => new URL(match[1], self.location.origin).href)
      .filter((url) => new URL(url).origin === self.location.origin);
    await cache.addAll(assets);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => OWN_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) && key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('/', response.clone()));
      return response;
    }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })));
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === 'string' ? payload.title : 'ALLPLAY';
  const body = typeof payload.body === 'string' ? payload.body : 'You have a new owner alert.';
  const target = typeof payload.url === 'string' ? payload.url : 'account';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: `allplay-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    data: { url: target },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || 'account', self.registration.scope);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url === target.href);
    if (existing) return existing.focus();
    return self.clients.openWindow(target.href);
  }));
});
