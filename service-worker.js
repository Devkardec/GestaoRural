// service-worker.js

const CACHE_NAME = 'agrocultive-cache-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/offline.html',
    '/manifest.json',
    'assets/img/Capa2.png',
    'assets/img/faviconsf.png'
];

// Evento de Instalação: Cacheia os arquivos essenciais do app
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Caching app shell');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

// Evento de Ativação: Limpa caches antigos
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Clearing old cache');
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Evento de Fetch: Intercepta requisições de rede
self.addEventListener('fetch', (event) => {
    // Ignora requisições do Firebase, que têm seu próprio manejo offline.
    if (event.request.url.includes('firestore.googleapis.com')) {
        return;
    }
    
    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request)
                .then((cachedResponse) => {
                    // Stale-While-Revalidate: Serve do cache e atualiza em segundo plano.
                    const fetchPromise = fetch(event.request).then((networkResponse) => {
                        // Se a requisição for bem-sucedida, atualiza o cache.
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => {
                        // Se a rede falhar e não houver cache, serve a página offline.
                        if (event.request.mode === 'navigate') {
                            return caches.match('/offline.html');
                        }
                    });

                    // Retorna a resposta do cache imediatamente se existir, senão aguarda a rede.
                    return cachedResponse || fetchPromise;
                });
        })
    );
});

// Gerenciamento de Notificações
let scheduledNotifications = new Map();

// Escutar mensagens do app principal
self.addEventListener('message', (event) => {
    const { type, title, body, tag } = event.data;
    
    if (type === 'SHOW_NOTIFICATION') {
        self.registration.showNotification(title, {
            body: body,
            icon: 'assets/img/faviconsf.png',
            badge: 'assets/img/faviconsf.png',
            tag: tag,
            requireInteraction: true,
            actions: [
                {
                    action: 'view',
                    title: 'Ver Detalhes'
                },
                {
                    action: 'dismiss',
                    title: 'Dispensar'
                }
            ],
            data: {
                url: '/',
                tag: tag
            }
        });
    } else if (type === 'CANCEL_NOTIFICATION') {
        // Cancelar notificação específica
        self.registration.getNotifications({ tag: tag }).then(notifications => {
            notifications.forEach(notification => notification.close());
        });
    }
});

// Lidar com cliques nas notificações
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    if (event.action === 'view' || !event.action) {
        // Abrir ou focar na janela do app
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then((clientList) => {
                    // Se já existe uma janela aberta, focar nela
                    for (const client of clientList) {
                        if (client.url.includes(self.location.origin) && 'focus' in client) {
                            return client.focus();
                        }
                    }
                    // Senão, abrir nova janela
                    if (clients.openWindow) {
                        return clients.openWindow('/');
                    }
                })
        );
    }
    // Se action === 'dismiss', apenas fecha a notificação (já feito acima)
});

// Lidar com fechamento de notificações
self.addEventListener('notificationclose', (event) => {
    console.log('Notificação fechada:', event.notification.tag);
});