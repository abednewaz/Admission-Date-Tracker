const CACHE = 'adt-v35';
const ASSETS = [
  './Abed_Newaz_Profile.png',
  './manifest.webmanifest?v=33',
  './favicon.png?v=33',
  './icon-192.png?v=33',
  './icon-512.png?v=33',
  './icon-light.svg?v=33',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  const isLiveData = url.pathname.endsWith('/index.html') || url.pathname.endsWith('/data.js') || url.pathname.endsWith('/notices.js') || url.pathname.endsWith('/system-status.js') || url.pathname.endsWith('/');
  if (isLiveData) {
    e.respondWith(
      fetch(new Request(e.request, {cache:'no-store'}))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Admission Tracker';
  const options = {
    body: data.body || 'A new admission notice is available.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'admission-notice',
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window', includeUncontrolled:true}).then((clientList) => {
    for (const client of clientList) {
      if ('focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(event.notification.data?.url || './');
  }));
});
