// backend/server.js

const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const asaasRoutes = require('./asaas/routes');
const asaasWebhook = require('./asaas/webhook');
const { createUserWithTrial } = require('./db');

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

const db = admin.firestore();
const messaging = admin.messaging();

// --- Configuração das Chaves VAPID ---
// IMPORTANTE: Use variáveis de ambiente para suas chaves VAPID!
// process.env.VAPID_PUBLIC_KEY (já está no frontend)
// process.env.VAPID_PRIVATE_KEY

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('Aviso: Variáveis de ambiente VAPID_PUBLIC_KEY ou VAPID_PRIVATE_KEY não definidas.');
    console.warn('As notificações Web Push podem não funcionar corretamente sem elas.');
}

// Middleware
// Usamos express.json() para a maioria das rotas
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

const verifyFirebaseToken = async (req, res, next) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!idToken) {
        return res.status(401).json({ error: 'Acesso não autorizado. Token não fornecido.' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.uid = decodedToken.uid; // Attach uid to the request
        next();
    } catch (error) {
        console.error('Erro ao verificar token:', error);
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
        // Para Web Push, o 'endpoint' da inscrição é o que o FCM usa como 'token'.
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

// Rotas do Asaas
app.use('/asaas', asaasRoutes);

// A rota do webhook usa o middleware para capturar o corpo bruto ANTES de passar para o router do webhook.
app.use('/asaas/webhook', captureRawBody, asaasWebhook);

// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
    console.log('Lembre-se de configurar as variáveis de ambiente!');
});
