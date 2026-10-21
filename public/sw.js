// Minimal service worker so the apps can be installed to the home screen (PWA).
// Network-first: the app always talks to the live server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
