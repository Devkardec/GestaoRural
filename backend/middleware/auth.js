
// backend/middleware/auth.js
const admin = require('firebase-admin');
const { findUserByUID, createUserWithTrial } = require('../db');

/**
 * Middleware para verificar o token de autenticação do Firebase
 * e checar o status premium do usuário.
 */
async function checkAuthAndPremium(req, res, next) {
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!idToken) {
        return res.status(401).json({ error: 'Acesso não autorizado. Token não fornecido.' });
    }

    try {
        // 1. Verifica o token do Firebase
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        // 2. Busca o usuário no Firestore; se não existir, cria automaticamente (auto-provisioning)
        let user = await findUserByUID(uid);
        if (!user) {
            console.log('⚠️  Usuário não encontrado. Criando perfil trial automaticamente:', uid);
            try {
                user = await createUserWithTrial(uid, { email: decodedToken.email, name: decodedToken.name });
                console.log('✅ Perfil trial criado on-demand.');
            } catch (createErr) {
                console.error('❌ Falha ao criar perfil trial automaticamente:', createErr);
                return res.status(500).json({ error: 'Falha ao criar perfil do usuário.' });
            }
        }

        // 3. Anexa o usuário ao objeto da requisição para uso posterior
        req.user = user;

        // MODO DE TESTE: Libera o acesso se a variável de ambiente estiver configurada
        if (process.env.ACCESS_CONTROL_MODE === 'open') {
            console.log(`AVISO: Servidor em modo de teste 'open'. Acesso liberado para o usuário: ${user.uid}`);
            return next();
        }

        // 4. Verifica o status premium
        const premiumStatus = user.premium.status;
        const trialEndDate = user.premium.trialEndDate.toDate(); // Converte Timestamp para Date

        const isTrialActive = premiumStatus === 'TRIAL' && new Date() < trialEndDate;
        const isPremiumActive = premiumStatus === 'ACTIVE';

        if (isTrialActive || isPremiumActive) {
            // Se o trial está ativo ou o plano premium está pago, permite o acesso.
            return next();
        }

        // 5. Se nenhuma condição for atendida, bloqueia o acesso.
        // Retorna um status específico para o frontend saber que precisa de pagamento.
        return res.status(403).json({
            error: 'Acesso premium necessário.',
            premiumStatus: 'INACTIVE'
        });

    } catch (error) {
        console.error('Erro de autenticação ou verificação premium:', error);
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token expirado. Por favor, faça login novamente.' });
        }
        return res.status(500).json({ error: 'Erro interno no servidor.' });
    }
}

/**
 * Middleware para verificar o token de autenticação do Firebase
 * e anexar os dados do usuário do Firestore à requisição (req.user).
 * Não bloqueia o acesso com base no status premium.
 */
async function checkAuth(req, res, next) {
    console.log('🔒 CheckAuth middleware called for:', req.method, req.path);
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!idToken) {
        console.log('❌ No authorization token provided');
        return res.status(401).json({ error: 'Acesso não autorizado. Token não fornecido.' });
    }

    try {
        console.log('🔍 Verifying Firebase token...');
        // 1. Verifica o token do Firebase
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;
        console.log('✅ Firebase token verified for user:', uid);

        // 2. Busca o usuário no Firestore
        console.log('📂 Fetching user from database...');
        const user = await findUserByUID(uid);
        if (!user) {
            console.log('❌ User not found in database for UID:', uid);
            return res.status(404).json({ error: 'Usuário não encontrado no banco de dados.' });
        }

        console.log('✅ User found in database:', {
            uid: user.uid,
            email: user.email,
            premiumStatus: user.premium?.status
        });

        // 3. Anexa o usuário ao objeto da requisição para uso posterior
        req.user = user;
        return next();

    } catch (error) {
        console.error('❌ Authentication error:', error);
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token expirado. Por favor, faça login novamente.' });
        }
        return res.status(500).json({ error: 'Erro interno no servidor.' });
    }
}

module.exports = { checkAuthAndPremium, checkAuth };
