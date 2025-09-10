// service-worker.js

const CACHE_NAME = 'agrocultive-cache-v3'; // Versão do cache incrementada
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/offline.html',
    '/manifest.json',
    'assets/img/Capa2.png',
    'assets/img/faviconsf.png',
    '/assets/js/agronomist-chat.js',
    '/assets/js/firebase-init.js',
    '/clientes.html',
    '/clientes.js',
    '/clientes.css',
    '/propriedade.html',
    '/propriedade.js',
    '/propriedade.css'
];

// Evento de Instalação: Cacheia os arquivos e força a ativação
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Caching app shell');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                // Força o novo service worker a se tornar ativo imediatamente.
                return self.skipWaiting();
            })
    );
});

// Evento de Ativação: Limpa caches antigos e assume o controle
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
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
        }).then(() => {
            // Torna-se o controlador para todos os clientes dentro do seu escopo.
            console.log('Service Worker: Claiming clients.');
            return self.clients.claim();
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
                        // Apenas armazena em cache requisições GET bem-sucedidas.
                        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
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

// Lidar com cliques nas notificações
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    const urlToOpen = event.notification.data.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // Se já existe uma janela aberta, focar nela e navegar para a URL
                for (const client of clientList) {
                    // Verifica se a URL do cliente é a raiz e se o cliente tem a função 'focus'
                    if (client.url.endsWith('/') && 'focus' in client) {
                        client.navigate(urlToOpen); // Navega para a URL da notificação
                        return client.focus();
                    }
                }
                // Senão, abrir nova janela já com a URL correta
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
    );
});

// Evento de Push para notificações do servidor
self.addEventListener('push', (event) => {
    console.log('Service Worker: Push Received.');

    let data = {};
    try {
        data = event.data.json();
    } catch (e) {
        console.log('Push data is not JSON, treating as text.');
        data = { notification: { title: 'Nova Notificação', body: event.data.text() } };
    }

    const notification = data.notification || {};
    const title = notification.title || 'AgroCultive';
    const options = {
        body: notification.body || 'Você tem uma nova mensagem.',
        icon: notification.icon || 'assets/img/faviconsf.png',
        badge: notification.badge || 'assets/img/faviconsf.png',
        tag: notification.tag || 'general-notification',
        data: {
            url: notification.click_action || data.fcmOptions?.link || '/'
        }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});