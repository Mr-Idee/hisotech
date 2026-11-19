self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'HI-SOTECH update', body: 'You have a new notification.' };
  }
  const requestedUrl = typeof payload.url === 'string' ? payload.url : '/#workspace';
  let safeUrl = '/#workspace';
  try {
    const parsedUrl = new URL(requestedUrl, self.location.origin);
    if (parsedUrl.origin === self.location.origin) {
      safeUrl = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    }
  } catch {
    safeUrl = '/#workspace';
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'HI-SOTECH update', {
    body: payload.body || 'You have a new notification.',
    data: { url: safeUrl },
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data?.url || '/#workspace';
  let target = new URL('/#workspace', self.location.origin).href;
  try {
    const parsedUrl = new URL(requestedUrl, self.location.origin);
    if (parsedUrl.origin === self.location.origin) target = parsedUrl.href;
  } catch {
    target = new URL('/#workspace', self.location.origin).href;
  }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
