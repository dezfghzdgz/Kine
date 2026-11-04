/*
 * Kine - service worker jen pro push oznámení (lib/pushClient.ts).
 *
 * Nic neukládá do mezipaměti a nezachytává požadavky - web se chová
 * přesně jako bez něj. Jen ukáže oznámení, které poslal server, a po
 * kliknutí otevře Kine na správné stránce (jen adresy uvnitř Kine).
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 120) : 'Kine';
  const options = {
    body: typeof data.body === 'string' ? data.body.slice(0, 300) : '',
    // Ikona Kine a malý bílý trojúhelník do horní lišty Androidu (tam je vidět
    // jen tvar - plná ikona by se ukázala jako bílý čtvereček).
    icon: '/icons/kine-192.png',
    badge: '/icons/kine-badge-96.png',
    tag: typeof data.tag === 'string' ? data.tag.slice(0, 80) : undefined,
    data: { url: typeof data.url === 'string' ? data.url : '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let target;
  try {
    target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  } catch (e) {
    target = new URL('/', self.location.origin);
  }
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(target.href);
            } catch (e) {
              /* stránka navigaci nepovolila - aspoň je v popředí */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })()
  );
});

// Prohlížeč obnovil přihlášení k oznámením (vypršelo) - pošli novou adresu serveru.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription;
        const key = old && old.options ? old.options.applicationServerKey : null;
        if (!key) return;
        const sub = event.newSubscription || (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of clients) c.postMessage({ type: 'kine-push-resubscribe', subscription: sub.toJSON() });
      } catch (e) {
        /* další otevření Kine to srovná (lib/pushClient.ts - syncPush) */
      }
    })()
  );
});
