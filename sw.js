/* WiseBase CRM — Service Worker (для GitHub Pages, рядом с index.html)
   Даёт: системные уведомления на iOS (в установленной PWA), приём web-push,
   клик по уведомлению → открытие CRM, офлайн-запуск оболочки. */
const CACHE = 'wisebase-shell-v1';
const ICON = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">\ud83d\udccb</text></svg>';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./'])).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Офлайн-оболочка: сеть → при неудаче кэш (только для навигации по самому приложению) */
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request);
      const c = await caches.open(CACHE);
      c.put('./', fresh.clone()).catch(() => {});
      return fresh;
    } catch (err) {
      const cached = await caches.match('./');
      return cached || Response.error();
    }
  })());
});

/* Локальные уведомления из открытого приложения */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title, {
      body: e.data.body,
      icon: ICON,
      badge: ICON,
      tag: e.data.tag || 'crm-notification'
    });
  }
});

/* Настоящий web-push с сервера (работает, даже когда приложение закрыто).
   Ожидаемый формат payload: {"title":"...","body":"...","tag":"...","url":"./"} */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'WiseBase CRM', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'WiseBase CRM', {
    body: d.body || '',
    icon: ICON,
    badge: ICON,
    tag: d.tag || 'crm-push',
    data: { url: d.url || './' }
  }));
});

/* Клик по уведомлению — фокусируем уже открытую CRM или открываем новую */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  })());
});
