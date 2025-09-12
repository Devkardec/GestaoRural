// service-worker.js

const CACHE_NAME = 'agrocultive-cache-v6'; // Versão do cache incrementada para forçar atualização
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
    // 1. Ignorar qualquer requisição que não seja GET (POST/PUT/DELETE/OPTIONS - inclusive preflight CORS)
    if (event.request.method !== 'GET') {
        return; // deixa seguir normalmente para a rede
    }

    // 2. Ignorar requisições cross-origin (ex: backend em onrender.com ou APIs externas)
    const requestUrl = new URL(event.request.url);
    const selfOrigin = self.location.origin;
    if (requestUrl.origin !== selfOrigin) {
        return; // não intercepta para não quebrar CORS
    }

    // 3. Ignora requisições do Firebase (caso sejam same-origin em algum cenário futuro)
    if (event.request.url.includes('firestore.googleapis.com')) {
        return; // Deixa a requisição passar para a rede
    }

    // Estratégia "Network First" para a página principal (index.html)
    if (event.request.mode === 'navigate' && (event.request.url.endsWith('/') || event.request.url.endsWith('/index.html'))) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Verifica se a resposta é válida antes de clonar
                    if (response && response.status === 200 && response.type === 'basic') {
                        // Se a rede funcionar, clona a resposta, armazena em cache e a retorna
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseToCache);
                        }).catch(err => {
                            console.warn('Failed to cache response:', err);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Se a rede falhar, tenta servir do cache
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Estratégia "Cache First" para outros assets same-origin GET
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // Se estiver no cache, retorna a resposta do cache
                if (cachedResponse) {
                    return cachedResponse;
                }
                // Se não, busca na rede
                return fetch(event.request).then(networkResponse => {
                    // Armazena a nova resposta em cache para futuras requisições
                    if (networkResponse && networkResponse.status === 200 && 
                        networkResponse.type === 'basic' && event.request.method === 'GET') {
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, networkResponse.clone());
                        }).catch(err => {
                            console.warn('Failed to cache network response:', err);
                        });
                    }
                    return networkResponse;
                }).catch(fetchError => {
                    console.warn('Network request failed:', fetchError);
                    throw fetchError;
                });
            })
            .catch(() => {
                // Se tudo falhar (sem cache, sem rede), serve a página offline para navegação
                if (event.request.mode === 'navigate') {
                    return caches.match('/offline.html');
                }
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
    if (event.data) {
        try { data = event.data.json(); }
        catch(e){
            console.warn('Push payload não JSON, usando texto simples');
            data = { notification: { title: 'AgroCultive', body: event.data.text() } };
        }
    }
    if (!data.notification) {
        data.notification = { title: 'AgroCultive', body: 'Atualização disponível.' };
    }

    const n = data.notification;
    const type = n.tag || n.type || 'generic';
    // Usar ícone absoluto para evitar falhas em alguns dispositivos Android que não resolvem caminho relativo em background
    const baseIcon = 'https://agrocultivegestaorural.com.br/assets/img/faviconsf.png';
    const iconMap = {
        'task': baseIcon,
        'application': baseIcon,
        'payment-late': baseIcon,
        'vaccine': baseIcon,
        'reminder': baseIcon,
        'generic': baseIcon
    };
    const actions = [
        { action: 'open', title: 'Abrir' }
        // Futuro: { action: 'adiar10', title: 'Adiar 10 min' }
    ];

    const options = {
        body: n.body || 'Você tem uma nova mensagem.',
        icon: n.icon || iconMap[type] || baseIcon,
        badge: n.badge || baseIcon,
        tag: n.tag || type,
        vibrate: n.vibrate || [100,50,100],
        requireInteraction: false,
        timestamp: Date.now(),
        data: {
            url: n.data?.url || n.click_action || '/',
            type: type,
            refId: n.data?.refId || null
        },
        actions
    };

    event.waitUntil(self.registration.showNotification(n.title || 'AgroCultive', options));
});