// backend/db.js

let _db; // Firestore instance (admin.firestore())
let _usersCollection; // Referência da coleção 'users'
const admin = require('firebase-admin');

// Function to initialize the db and usersCollection
function initializeDb(dbInstance) {
    _db = dbInstance;
    _usersCollection = _db.collection('users');
}

/**
 * Cria um novo usuário no Firestore com período de trial.
 * @param {string} uid - O UID do Firebase Authentication.
 * @param {object} userData - Dados do usuário (name, email, cpfCnpj).
 * @returns {object} O novo usuário criado.
 */
async function createUserWithTrial(uid, userData) {
    const trialStartDate = admin.firestore.FieldValue.serverTimestamp();
    // 7 dias de trial
    const trialEndDateJS = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const newUser = {
        uid,
        name: userData.name || userData.email?.split('@')[0] || 'Usuário',
        email: userData.email || null,
        cpfCnpj: userData.cpfCnpj || null,
        asaasCustomerId: null,
        createdAt: trialStartDate,
        premium: {
            status: 'TRIAL',
            trialStartDate: trialStartDate,
            trialEndDate: admin.firestore.Timestamp.fromDate(trialEndDateJS),
            subscriptionId: null,
            lastUpdate: trialStartDate,
            paymentLink: null
        }
    };

    await _usersCollection.doc(uid).set(newUser, { merge: true });
    return newUser;
}

/**
 * Busca um usuário pelo UID do Firebase.
 * @param {string} uid - O UID do Firebase Authentication.
 */
async function findUserByUID(uid) {
    console.log('🔍 Searching for user in database with UID:', uid);
    try {
        const userDoc = await _usersCollection.doc(uid).get();
        if (!userDoc.exists) {
            console.log('❌ User document not found for UID:', uid);
            return null;
        }
        console.log('✅ User document found for UID:', uid);
        const userData = { id: userDoc.id, ...userDoc.data() };
        console.log('📄 User data retrieved:', {
            uid: userData.uid,
            email: userData.email,
            premiumStatus: userData.premium?.status
        });
        return userData;
    } catch (error) {
        console.error('❌ Error fetching user from database:', error);
        throw error;
    }
}

/**
 * Busca um usuário pelo ID de cliente do Asaas.
 * @param {string} asaasCustomerId - O ID do cliente no Asaas (cus_...).
 */
async function findUserByAsaasId(asaasCustomerId) {
    const snapshot = await _usersCollection.where('asaasCustomerId', '==', asaasCustomerId).limit(1).get();
    if (snapshot.empty) {
        return null;
    }
    const userDoc = snapshot.docs[0];
    return { id: userDoc.id, ...userDoc.data() };
}

/**
 * Atualiza dados de um usuário específico.
 * @param {string} uid - O UID do usuário a ser atualizado.
 * @param {object} dataToUpdate - Os campos a serem atualizados.
 */
async function updateUser(uid, dataToUpdate) {
    await _usersCollection.doc(uid).update(dataToUpdate);
    return findUserByUID(uid);
}

module.exports = {
    initializeDb,
    createUserWithTrial,
    findUserByUID,
    findUserByAsaasId,
    updateUser,
};

/**
 * Normaliza a estrutura do usuário existente (backfill para documentos antigos)
 * Garante presença de: uid, premium.status, premium.trialEndDate etc.
 */
async function normalizeUserIfNeeded(rawUser) {
    if (!rawUser) return null;
    const updates = {};
    let needUpdate = false;

    // uid ausente -> usar o id do documento
    if (!rawUser.uid) {
        updates.uid = rawUser.id;
        needUpdate = true;
    }

    // premium ausente ou incompleto
    if (!rawUser.premium || typeof rawUser.premium !== 'object') {
        const trialStartDate = admin.firestore.FieldValue.serverTimestamp();
        const trialEndDate = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7*24*60*60*1000));
        updates.premium = {
            status: 'TRIAL',
            trialStartDate,
            trialEndDate,
            subscriptionId: null,
            lastUpdate: trialStartDate,
            paymentLink: null
        };
        needUpdate = true;
    } else {
        // Garantir campos internos
        const p = rawUser.premium;
        if (!p.status) { updates['premium.status'] = 'TRIAL'; needUpdate = true; }
        if (!p.trialEndDate) { updates['premium.trialEndDate'] = admin.firestore.Timestamp.fromDate(new Date(Date.now()+7*24*60*60*1000)); needUpdate = true; }
        if (!p.trialStartDate) { updates['premium.trialStartDate'] = admin.firestore.FieldValue.serverTimestamp(); needUpdate = true; }
    }

    if (needUpdate) {
        await _usersCollection.doc(rawUser.id).set(updates, { merge: true });
        // Recarrega
        const refreshed = await _usersCollection.doc(rawUser.id).get();
        return { id: refreshed.id, ...refreshed.data() };
    }
    return rawUser;
}

module.exports.normalizeUserIfNeeded = normalizeUserIfNeeded;