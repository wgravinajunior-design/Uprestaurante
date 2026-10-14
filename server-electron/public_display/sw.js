// Service worker: recebe o Web Push (senha pronta) mesmo com a pagina fechada e a tela bloqueada.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
    event.waitUntil(self.registration.showNotification(d.titulo || 'Seu pedido', {
        body: d.corpo || '',
        tag: 'pedido-' + (d.senha || 'x'),
        renotify: true,
        requireInteraction: true,
        vibrate: [400, 150, 400, 150, 800],
        data: { url: d.url || '/senha' }
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/senha';
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
        for (const c of lista) { if ('focus' in c) return c.focus(); }
        return self.clients.openWindow(url);
    }));
});
