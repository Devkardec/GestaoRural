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

// --- Web Push local (alternativa ao Netlify) ---
const webpush = require('web-push');
const cron = require('node-cron');
const { processReminders } = require('./cron/processReminders');
function ensureVapidLocal() {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        throw new Error('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes no backend (Render).');
    }
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:suporte@agrocultive.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

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

// (IMPORTANTE) NÃO aplicar express.json antes do webhook do Asaas, pois precisamos do raw body para validar assinatura.
// O express.json virá depois do mount do webhook.

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

// Rota para criar o perfil de um novo usuário no Firestore com período de teste
app.post('/api/create-user-profile', verifyFirebaseToken, async (req, res) => {
    // O UID vem do token verificado, garantindo que o usuário só pode criar seu próprio perfil
    const uid = req.uid;
    const { email, name, cpfCnpj } = req.body;

    if (!email || !name) {
        return res.status(400).json({ error: 'Email e Nome são obrigatórios.' });
    }

    try {
        const newUser = await createUserWithTrial(uid, { email, name, cpfCnpj });
    console.log(`Perfil com teste criado para o usuário: ${uid}`);
        res.status(201).json({ message: 'Perfil do usuário criado com sucesso.', user: newUser });
    } catch (error) {
        console.error('Erro ao criar perfil do usuário:', error);
        res.status(500).json({ error: 'Falha ao criar o perfil do usuário.' });
    }
});

// Rota para salvar a inscrição do usuário
app.post('/api/save-subscription', express.json(), async (req, res) => {
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

// Envio de Web Push direto pelo backend (Render)
app.post('/api/send-webpush', express.json(), async (req, res) => {
    if (!req.body) return res.status(400).json({ error: 'Body ausente' });
    const { userId, title, body, url, type, refId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });
    try {
        ensureVapidLocal();
        const subDoc = await db.collection('subscriptions').doc(userId).get();
        if (!subDoc.exists) return res.status(404).json({ error: 'Subscription não encontrada para userId.' });
        const subscription = subDoc.data();
        const payload = {
            notification: {
                title: title || 'AgroCultive',
                body: body || 'Você tem uma nova atualização.',
                tag: type || 'generic',
                icon: 'assets/img/faviconsf.png',
                badge: 'assets/img/faviconsf.png',
                data: { url: url || '/', type: type || 'generic', refId: refId || null }
            }
        };
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        return res.json({ success: true });
    } catch (e) {
        console.error('Falha ao enviar push local:', e?.statusCode, e?.message, e?.body ? `Body: ${e.body}` : '');
        if (e?.statusCode === 410 || e?.statusCode === 404) {
            try { await db.collection('subscriptions').doc(userId).delete(); } catch(_){ }
        }
        return res.status(500).json({ error: 'Falha ao enviar push', details: e.message, code: e.statusCode || null, body: e.body || null });
    }
});

// Expor configuração pública (chave VAPID pública) para evitar divergência de chaves
app.get('/config/public', (req, res) => {
    const pub = process.env.VAPID_PUBLIC_KEY || null;
    const subject = process.env.VAPID_SUBJECT || null;
    res.json({ vapidPublicKey: pub, subject });
});

// Endpoint manual para disparar cron (protegido por ADMIN_FORCE_TOKEN)
app.post('/internal/cron/process-reminders', express.json(), async (req, res) => {
    try {
        const secret = process.env.ADMIN_FORCE_TOKEN;
        if (!secret) return res.status(500).json({ error: 'ADMIN_FORCE_TOKEN não configurado.' });
        const { token } = req.body || {};
        if (!token || token !== secret) return res.status(403).json({ error: 'Token inválido.' });
        const result = await processReminders(db);
        return res.json(result);
    } catch (e) {
        console.error('Erro ao processar reminders manual:', e);
        return res.status(500).json({ error: 'Falha no cron manual', details: e.message });
    }
});

// Agendamento via node-cron (a cada minuto) controlado por variável ENABLE_CRON
if (process.env.ENABLE_CRON === 'true') {
    cron.schedule('*/1 * * * *', async () => {
        try {
            const result = await processReminders(db);
            console.log('Cron reminders:', result);
        } catch (e) {
            console.error('Falha cron reminders:', e);
        }
    }, { timezone: 'America/Sao_Paulo' });
    console.log('Cron de reminders habilitado (*/1 * * * *).');
} else {
    console.log('Cron de reminders desabilitado (ENABLE_CRON != true).');
}
// Body parsing global EXCETO para webhook Asaas (mantemos raw body para assinatura)
app.use((req, res, next) => {
    if (req.path.startsWith('/asaas/webhook')) return next();
    return express.json()(req, res, next);
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

// ------------------------------------------------------------
// ROTA INTERNA: Forçar ativação premium (uso emergencial)
// Protegida por token secreto em variável de ambiente: ADMIN_FORCE_TOKEN
// POST /internal/force-active  { token: 'SEGREDO', uid: 'UID_DO_USUARIO' }
// ------------------------------------------------------------
app.post('/internal/force-active', async (req, res) => {
    try {
        const secret = process.env.ADMIN_FORCE_TOKEN;
        if (!secret) {
            return res.status(500).json({ error: 'ADMIN_FORCE_TOKEN não configurado no servidor.' });
        }
        const { token, uid } = req.body || {};
        if (!token || token !== secret) {
            return res.status(403).json({ error: 'Token inválido.' });
        }
        if (!uid) {
            return res.status(400).json({ error: 'UID é obrigatório.' });
        }

    // Busca usuário; se não existir, cria perfil de teste primeiro
        const { findUserByUID, createUserWithTrial, updateUser } = require('./db');
        let user = await findUserByUID(uid);
        if (!user) {
            user = await createUserWithTrial(uid, { email: null, name: 'Novo Usuário' });
        }

        const farFuture = new Date();
        farFuture.setFullYear(farFuture.getFullYear() + 5); // +5 anos

        await updateUser(uid, {
            'premium.status': 'ACTIVE',
            'premium.trialEndDate': admin.firestore.Timestamp.fromDate(farFuture),
            'premium.lastUpdate': new Date()
        });

        return res.status(200).json({
            message: 'Usuário promovido a Ativo',
            uid,
            expires: farFuture.toISOString()
        });
    } catch (err) {
        console.error('Erro em /internal/force-active:', err);
        return res.status(500).json({ error: 'Falha ao promover usuário.' });
    }
});

// Ativação simples para o próprio dono (sem token secreto) - exige autenticação Firebase
// POST /internal/activate-self  (Authorization: Bearer <idToken>)
// Se o uid for o do administrador fallback, promove a ACTIVE.
app.post('/internal/activate-self', verifyFirebaseToken, async (req, res) => {
    const OWNER_UID = 'W5luXYrJD3dQFMa4otcXZxRk0rk1'; // Fallback hardcoded (REMOVER em produção final)
    try {
        if (req.uid !== OWNER_UID) {
            return res.status(403).json({ error: 'Apenas o dono pode usar esta rota.' });
        }
        const { updateUser } = require('./db');
        const farFuture = new Date();
        farFuture.setFullYear(farFuture.getFullYear() + 5);
        await updateUser(req.uid, {
            'premium.status': 'ACTIVE',
            'premium.trialEndDate': admin.firestore.Timestamp.fromDate(farFuture),
            'premium.lastUpdate': new Date()
        });
    return res.json({ message: 'Conta ativada como Ativa', uid: req.uid, until: farFuture.toISOString() });
    } catch (e) {
        console.error('Erro em /internal/activate-self:', e);
        return res.status(500).json({ error: 'Falha ao ativar.' });
    }
});

// Rota do webhook PRIMEIRO captura raw body (sem express.json())
app.use('/asaas/webhook', captureRawBody, asaasWebhook);

// Demais rotas Asaas (já podem usar express.json())
app.use('/asaas', asaasRoutes);

// ------------------- ENDPOINTS ADMINISTRATIVOS PREMIUM -------------------
// POST /internal/premium/reactivate  { token, uid, years? }
app.post('/internal/premium/reactivate', async (req, res) => {
    try {
        const secret = process.env.ADMIN_FORCE_TOKEN;
        if (!secret) return res.status(500).json({ error: 'ADMIN_FORCE_TOKEN não configurado.' });
        const { token, uid, years = 1 } = req.body || {};
        if (!token || token !== secret) return res.status(403).json({ error: 'Token inválido.' });
        if (!uid) return res.status(400).json({ error: 'UID obrigatório.' });
        const { findUserByUID, createUserWithTrial, updateUser } = require('./db');
        let user = await findUserByUID(uid);
        if (!user) user = await createUserWithTrial(uid, { email: null, name: 'Novo Usuário' });
        const future = new Date();
        future.setFullYear(future.getFullYear() + Number(years));
        await updateUser(uid, {
            'premium.status': 'ACTIVE',
            'premium.trialEndDate': admin.firestore.Timestamp.fromDate(future),
            'premium.lastUpdate': new Date()
        });
    return res.json({ message: 'Usuário reativado como Ativo', uid, until: future.toISOString() });
    } catch (e) {
        console.error('Erro em /internal/premium/reactivate:', e);
        return res.status(500).json({ error: 'Falha ao reativar.' });
    }
});

// POST /internal/premium/reset-trial { token, uid, days? }
app.post('/internal/premium/reset-trial', async (req, res) => {
    try {
        const secret = process.env.ADMIN_FORCE_TOKEN;
        if (!secret) return res.status(500).json({ error: 'ADMIN_FORCE_TOKEN não configurado.' });
        const { token, uid, days = 7 } = req.body || {};
        if (!token || token !== secret) return res.status(403).json({ error: 'Token inválido.' });
        if (!uid) return res.status(400).json({ error: 'UID obrigatório.' });
        const { findUserByUID, createUserWithTrial, updateUser } = require('./db');
        let user = await findUserByUID(uid);
        if (!user) user = await createUserWithTrial(uid, { email: null, name: 'Novo Usuário' });
        const end = new Date(Date.now() + days * 86400000);
        await updateUser(uid, {
            'premium.status': 'TRIAL',
            'premium.trialEndDate': admin.firestore.Timestamp.fromDate(end),
            'premium.lastUpdate': new Date()
        });
    return res.json({ message: 'Teste redefinido', uid, trialEnds: end.toISOString(), days });
    } catch (e) {
        console.error('Erro em /internal/premium/reset-trial:', e);
    return res.status(500).json({ error: 'Falha ao resetar teste.' });
    }
});

// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
    console.log('Lembre-se de configurar as variáveis de ambiente!');
});