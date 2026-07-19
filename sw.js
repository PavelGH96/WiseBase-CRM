// ============================================================
// WiseBase CRM — Service Worker
// Два независимых назначения:
//   1) ОФЛАЙН-ЗАПУСК — кешируем саму страницу и внешние библиотеки (Supabase JS,
//      XLSX, шрифты), которые она подключает с CDN. Без этого приложение просто не
//      открылось бы без сети: даже если браузер закешировал HTML, скрипт
//      `const sb = supabase.createClient(...)` упал бы с ошибкой, если библиотека
//      Supabase не загрузилась — а раньше она загружалась только «живьём» из сети.
//   2) PUSH-УВЕДОМЛЕНИЯ — приходят даже при полностью закрытом приложении. Именно
//      ради него этот файл нужно размещать РЯДОМ с index.html на хостинге: Safari
//      на iOS не принимает Service Worker, зарегистрированный из blob внутри страницы.
// ============================================================

const CACHE_NAME = 'wisebase-shell-v1';

// «Оболочка» — то, без чего приложение не откроется вообще. Кешируем при установке,
// чтобы это точно было готово ДО первого открытия в офлайне (а не только после
// первого успешного запуска онлайн, когда fetch-обработчик ниже успел бы это сделать).
const SHELL_URLS = [
  './',
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Manrope:wght@400;500;600;700;800&family=Playfair+Display:wght@500&display=swap',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // fetch()+put(), а не cache.add() — у add() есть особенность: он отклоняет
      // «непрозрачные» (opaque) кросс-доменные ответы, даже если запрос по факту
      // успешен. Для внешних CDN (Supabase JS, XLSX, шрифты) ответ всегда opaque —
      // с add() они молча не закешировались бы вообще.
      // allSettled, а не all — если один ресурс не закешировался (например, из-за
      // временной недоступности CDN), это не должно сорвать установку остальных.
      Promise.allSettled(SHELL_URLS.map(url => {
        const req = new Request(url, { mode: url.startsWith('http') ? 'no-cors' : 'same-origin' });
        return fetch(req).then(res => cache.put(req, res));
      }))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // POST/PATCH к Supabase не трогаем — не наша забота

  // Сами данные (REST API, авторизация, realtime) — всегда напрямую в сеть. Кешировать
  // их не нужно и опасно: офлайн-очередь изменений уже реализована в самом приложении,
  // и подменять здесь эти ответы значило бы показывать устаревшие данные молча.
  if (/\.supabase\.co\/(rest|auth|realtime|functions)\//.test(req.url)) return;

  // Стратегия «сеть, с запасным кешем»: если сеть есть — берём свежее и обновляем
  // кеш попутно; если сети нет — отдаём то, что закешировано (может быть чуть устаревшим,
  // но приложение хотя бы откроется, а не покажет ошибку браузера «нет соединения»).
  e.respondWith(
    fetch(req).then(res => {
      // opaque (кросс-доменные запросы в режиме no-cors — все внешние CDN) всегда
      // дают status 0 и ok=false, ДАЖЕ ПРИ УСПЕХЕ — это особенность самого fetch,
      // а не признак ошибки, поэтому проверяем это отдельно и тоже кешируем.
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        return res;
      }
      // Настоящая ошибка того же источника (404/500 и т.п., не обрыв сети) — берём кеш.
      return caches.match(req).then(cached => cached || res);
    }).catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
  );
});

const ICON = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📋</text></svg>';

// Локальное уведомление, пока приложение открыто (см. sendBrowserNotification()).
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title, {
      body: e.data.body,
      icon: ICON,
      tag: e.data.tag || 'crm-notification'
    });
  }
});

// Настоящий push с сервера — приходит даже при полностью закрытом приложении.
// Формат payload задаёт send-push.ts / send-task-reminders: { title, body, tag, url }.
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'WiseBase', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'WiseBase CRM';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: ICON,
      tag: data.tag || 'crm-push',
      data: { url: data.url || './' }
    })
  );
});

// Клик по уведомлению — открыть приложение (или переключиться на уже открытую вкладку).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
