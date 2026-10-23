// Nena service worker: installable PWA + web push notifications.
// Network-first: the app always talks to the live server.
const VERSION = 3;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'نِنا', body: event.data?.text() }; }
  const options = {
    body: data.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    requireInteraction: Boolean(data.urgent),
    vibrate: data.urgent ? [300, 120, 300, 120, 300] : [150],
    dir: 'rtl',
    lang: 'fa',
    data: { url: data.url || '/', v: VERSION },
  };
  event.waitUntil(self.registration.showNotification(data.title || 'نِنا', options));
});

// Focus an open tab of the right app, or open it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = url.pathname.split('/')[1];
    const tab = tabs.find((c) => new URL(c.url).pathname.split('/')[1] === app);
    if (tab) {
      await tab.focus();
      if (url.hash) tab.navigate?.(url.href);
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});
