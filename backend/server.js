// backend/server.js

const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors'); // Reativado para simplificar CORS
const asaasRoutes = require('./asaas/routes');
const asaasWebhook = require('./asaas/webhook');
const { createUserWithTrial, initializeDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Configuração do Firebase Admin SDK ---
// IMPORTANTE: Use variáveis de ambiente para suas credenciais!
// O conteúdo do seu arquivo JSON de chave de conta de serviço deve ser uma string JSON.
// Ex: process.env.FIREBASE_SERVICE_ACCOUNT_KEY = '{"type": "service_account", ...}'

// Certifique-se de que a variável de ambiente está definida
if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    console.error('Erro: Variável de ambiente FIREBASE_SERVICE_ACCOUNT_KEY não definida.');
    process.exit(1);
}

// Parse o JSON da variável de ambiente
let serviceAccount;
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
} catch (e) {
    console.error('Erro ao analisar FIREBASE_SERVICE_ACCOUNT_KEY. Certifique-se de que é um JSON válido.', e);
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore(); // Initialize db here
initializeDb(db); // Pass the initialized db to db.js

const messaging = admin.messaging(); // Keep messaging if it's used elsewhere in server.js

// --- Configuração das Chaves VAPID ---
// IMPORTANTE: Use variáveis de ambiente para suas chaves VAPID!
// process.env.VAPID_PUBLIC_KEY (já está no frontend)
// process.env.VAPID_PRIVATE_KEY

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('Aviso: Variáveis de ambiente VAPID_PUBLIC_KEY ou VAPID_PRIVATE_KEY não definidas.');
    console.warn('As notificações Web Push podem não funcionar corretamente sem elas.');
}

// --- Middleware Base ---
// CORS primeiro (modo permissivo para estabilizar)
app.use(cors({
    origin: (origin, callback) => {
        // Permite chamadas sem origin (ex: curl) e qualquer origin listado.
        const allowed = [
            'https://agrocultivegestaorural.com.br',
            'http://localhost:3000',
            'http://localhost:5000',
            'http://127.0.0.1:5500'
        ];
        if (!origin || allowed.includes(origin)) return callback(null, true);
        return callback(null, true); // Temporariamente permite todos para diagnóstico
    },
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
    credentials: false, // Não precisamos de cookies; facilita CORS
    maxAge: 86400
}));

// Preflight explícito (garantia extra)
app.options('*', (req,res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Vary','Origin');
    res.header('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers','Origin, X-Requested-With, Content-Type, Accept, Authorization');
    return res.sendStatus(200);
});

// Body parsing
app.use(express.json());

// O webhook do Asaas precisa do corpo bruto (raw) para verificar a assinatura.
// Criamos um middleware que só se aplica à rota do webhook para capturar esse corpo.
const captureRawBody = (req, res, next) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
        data += chunk;
    });
    req.on('end', () => {
        req.rawBody = data;
        next();
    });
};

// --- Rotas da API ---

// Health check route
app.get('/health', (req, res) => {
    console.log('🩺 Health check requested');
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        server: 'AgrocultiveBackend',
        version: '1.0.0'
    });
});

const verifyFirebaseToken = async (req, res, next) => {
    console.log('🔐 Verifying Firebase token for:', req.method, req.path);
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!idToken) {
        console.log('❌ No token provided');
        return res.status(401).json({ error: 'Acesso não autorizado. Token não fornecido.' });
    }

    try {
        console.log('🔍 Verifying token...');
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        console.log('✅ Token verified for user:', decodedToken.uid);
        req.uid = decodedToken.uid; // Attach uid to the request
        next();
    } catch (error) {
        console.error('❌ Token verification failed:', error.message);
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
};

// Rota para criar o perfil de um novo usuário no Firestore com trial
app.post('/api/create-user-profile', verifyFirebaseToken, async (req, res) => {
    // O UID vem do token verificado, garantindo que o usuário só pode criar seu próprio perfil
    const uid = req.uid;
    const { email, name, cpfCnpj } = req.body;

    if (!email || !name) {
        return res.status(400).json({ error: 'Email e Nome são obrigatórios.' });
    }

    try {
        const newUser = await createUserWithTrial(uid, { email, name, cpfCnpj });
        console.log(`Perfil com trial criado para o usuário: ${uid}`);
        res.status(201).json({ message: 'Perfil do usuário criado com sucesso.', user: newUser });
    } catch (error) {
        console.error('Erro ao criar perfil do usuário:', error);
        res.status(500).json({ error: 'Falha ao criar o perfil do usuário.' });
    }
});

// Rota para salvar a inscrição do usuário
app.post('/api/save-subscription', async (req, res) => {
    const subscription = req.body.subscription;
    const userId = req.body.userId; // Opcional: se você associar a inscrição a um usuário

    if (!subscription) {
        return res.status(400).json({ error: 'Subscription object is missing.' });
    }

    try {
        // Você pode armazenar isso no Firestore, em uma coleção 'subscriptions'
        // ou em qualquer outro banco de dados que você preferir.
        // Usaremos o Firestore aqui para consistência com o frontend.
        const docRef = db.collection('subscriptions').doc(userId || subscription.endpoint);
        await docRef.set({
            ...subscription,
            userId: userId || null, // Salva o userId se fornecido
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }); // Usa merge para atualizar se já existir

        console.log('Subscription saved:', subscription.endpoint);
        res.status(200).json({ message: 'Subscription saved successfully.' });
    } catch (error) {
        console.error('Error saving subscription:', error);
        res.status(500).json({ error: 'Failed to save subscription.' });
    }
});

// Rota de exemplo para enviar uma notificação de teste
// Em um ambiente real, esta rota seria acionada por alguma lógica de negócio
// (ex: um lembrete agendado, uma nova mensagem, etc.), e não diretamente por um POST do frontend.
app.post('/api/send-test-notification', async (req, res) => {
    const { userId, title, body, url } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'User ID is required to send a test notification.' });
    }

    try {
        // Busca a inscrição do usuário no Firestore
        const docRef = db.collection('subscriptions').doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Subscription not found for this user.' });
        }

        const subscription = doc.data();

        const message = {
            notification: {
                title: title || 'Notificação de Teste',
                body: body || 'Esta é uma notificação de teste do seu backend!',
            },
            webpush: {
                headers: {
                    Urgency: 'high',
                },
                notification: {
                    icon: 'https://your-pwa-domain.com/assets/img/faviconsf.png', // Substitua pelo seu domínio real
                    badge: 'https://your-pwa-domain.com/assets/img/faviconsf.png',
                    data: {
                        url: url || '/',
                    },
                },
            },
            token: subscription.token || subscription.endpoint, // FCM usa 'token', Web Push usa 'endpoint'
        };

        // Se você estiver usando o FCM para Web Push, o token é o endpoint da inscrição.
        // Se você estiver usando o FCM para Android/iOS, o token seria o registration token do dispositivo.
        // Para Web Push, o FCM pode usar o endpoint diretamente como token.
        // No entanto, o Admin SDK espera um 'token' ou 'topic' ou 'condition'.
        // Para Web Push, o FCM pode usar o endpoint diretamente como token.
        // A biblioteca 'web-push' lida com isso automaticamente, mas com o Admin SDK, é mais direto.
        // Para simplificar, vamos usar o endpoint como o token para o FCM.
        message.token = subscription.endpoint; // Usar o endpoint como token para FCM Web Push

        const response = await messaging.send(message);
        console.log('Successfully sent test message:', response);
        res.status(200).json({ message: 'Test notification sent successfully.', response });
    } catch (error) {
        console.error('Error sending test notification:', error);
        res.status(500).json({ error: 'Failed to send test notification.', details: error.message });
    }
});

// Middleware de logging para todas as requisições
app.use((req, res, next) => {
    console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.path}`, {
        origin: req.headers.origin,
        userAgent: req.headers['user-agent']?.substring(0, 50) + '...',
        authorization: req.headers.authorization ? 'Bearer ***' : 'None'
    });
    next();
});

// Reforço CORS final (caso algum fluxo saia antes do cors principal)
app.use((req, res, next) => {
    // Só adiciona se ainda não existe
    if (!res.get('Access-Control-Allow-Origin')) {
        res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    }
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Rota de debug para inspecionar cabeçalhos e origem (REMOVER em produção)
app.get('/debug/cors', (req, res) => {
    res.json({
        receivedOrigin: req.headers.origin || null,
        method: req.method,
        path: req.path,
        corsHeaders: {
            'Access-Control-Allow-Origin': res.get('Access-Control-Allow-Origin') || null,
            'Access-Control-Allow-Methods': res.get('Access-Control-Allow-Methods') || null,
            'Access-Control-Allow-Headers': res.get('Access-Control-Allow-Headers') || null,
            'Vary': res.get('Vary') || null
        },
        timestamp: new Date().toISOString()
    });
});

// Rotas do Asaas (definir ANTES do webhook para evitar conflitos)
app.use('/asaas', asaasRoutes);

// A rota do webhook usa o middleware para capturar o corpo bruto e deve ser mais específica
app.use('/asaas/webhook', captureRawBody, asaasWebhook);

// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
    console.log('Lembre-se de configurar as variáveis de ambiente!');
});