
// backend/middleware/auth.js
const admin = require('firebase-admin');
const { findUserByUID, createUserWithTrial, normalizeUserIfNeeded, updateUser } = require('../db');

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

        // Normalização (backfill de documentos antigos sem premium)
        user = await normalizeUserIfNeeded(user);

        // 3. Bypass para administradores (lista em variável de ambiente ADMIN_UIDS=uid1,uid2,...)
        const adminUids = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (adminUids.includes(user.uid)) {
            if (!user.premium || user.premium.status !== 'ACTIVE') {
                try {
                    await updateUser(user.uid, {
                        'premium.status': 'ACTIVE',
                        'premium.lastUpdate': new Date()
                    });
                    user.premium = { ...(user.premium || {}), status: 'ACTIVE' };
                    console.log('👑 Admin promovido automaticamente a ACTIVE:', user.uid);
                } catch (e) {
                    console.warn('Não foi possível promover admin automaticamente agora:', e.message);
                }
            }
            req.user = user;
            return next();
        }

        // 4. Anexa o usuário normal à request
        req.user = user;

        // 5. Modo aberto opcional
        if (process.env.ACCESS_CONTROL_MODE === 'open') {
            console.log(`AVISO: Servidor em modo de teste 'open'. Acesso liberado para o usuário: ${user.uid}`);
            return next();
        }

        // 6. Verifica status premium/trial
        const premiumStatus = user.premium.status;
        const trialEndDate = user.premium.trialEndDate.toDate();
        const isTrialActive = premiumStatus === 'TRIAL' && new Date() < trialEndDate;
        const isPremiumActive = premiumStatus === 'ACTIVE';
        if (isTrialActive || isPremiumActive) return next();

        // 7. Bloqueia se expirado/inativo
        return res.status(403).json({ error: 'Acesso premium necessário.', premiumStatus: 'INACTIVE' });

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

        console.log('✅ User found in database (normalizado):', {
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
