/* Service Worker Oops — menerima Web Push saat tab dashboard tertutup. */

self.addEventListener('install', function (event) {
  // Aktif langsung tanpa menunggu tab lama ditutup, supaya versi baru
  // service worker segera dipakai setelah deploy.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Oops', body: event.data ? event.data.text() : 'Ada notifikasi baru.' };
  }

  var title = data.title || 'Oops';
  var options = {
    body: data.body || '',
    // Tag per client+jenis alert: notifikasi baru untuk masalah yang sama
    // menggantikan yang lama, bukan menumpuk di notification center.
    tag: data.tag || 'oops-alert',
    renotify: data.severity === 'critical',
    requireInteraction: data.severity === 'critical',
    timestamp: data.timestamp || Date.now(),
    data: { url: data.url || '/' },
    icon: '/icon-192.png',
    badge: '/badge-72.png',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/';

  // Kalau dashboard sudah terbuka di salah satu tab, fokuskan tab itu
  // alih-alih membuka tab baru setiap kali notifikasi diklik.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
