// backend/db.js

let _db; // Will be set by initializeDb
let _usersCollection; // Will be set by initializeDb

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
    const trialStartDate = _db.FieldValue.serverTimestamp();
    const trialEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const newUser = {
        uid,
        ...userData,
        asaasCustomerId: null,
        premium: {
            status: 'TRIAL',
            trialStartDate: trialStartDate,
            trialEndDate: _db.Timestamp.fromDate(trialEndDate),
            subscriptionId: null,
            lastUpdate: trialStartDate,
            paymentLink: null
        }
    };

    await _usersCollection.doc(uid).set(newUser);
    return newUser;
}

/**
 * Busca um usuário pelo UID do Firebase.
 * @param {string} uid - O UID do Firebase Authentication.
 */
async function findUserByUID(uid) {
    const userDoc = await _usersCollection.doc(uid).get();
    if (!userDoc.exists) {
        return null;
    }
    return { id: userDoc.id, ...userDoc.data() };
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