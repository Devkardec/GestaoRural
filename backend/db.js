// backend/db.js
const admin = require('firebase-admin');

// O admin já foi inicializado em server.js, aqui apenas pegamos a instância.
const db = admin.firestore();
const usersCollection = db.collection('users');

/**
 * Cria um novo usuário no Firestore com período de trial.
 * @param {string} uid - O UID do Firebase Authentication.
 * @param {object} userData - Dados do usuário (name, email, cpfCnpj).
 * @returns {object} O novo usuário criado.
 */
async function createUserWithTrial(uid, userData) {
    const trialStartDate = admin.firestore.FieldValue.serverTimestamp();
    const trialEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const newUser = {
        uid,
        ...userData,
        asaasCustomerId: null,
        premium: {
            status: 'TRIAL',
            trialStartDate: trialStartDate,
            trialEndDate: admin.firestore.Timestamp.fromDate(trialEndDate),
            subscriptionId: null,
            lastUpdate: trialStartDate,
            paymentLink: null
        }
    };

    await usersCollection.doc(uid).set(newUser);
    return newUser;
}

/**
 * Busca um usuário pelo UID do Firebase.
 * @param {string} uid - O UID do Firebase Authentication.
 */
async function findUserByUID(uid) {
    const userDoc = await usersCollection.doc(uid).get();
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
    const snapshot = await usersCollection.where('asaasCustomerId', '==', asaasCustomerId).limit(1).get();
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
    await usersCollection.doc(uid).update(dataToUpdate);
    return findUserByUID(uid);
}

module.exports = {
    createUserWithTrial,
    findUserByUID,
    findUserByAsaasId,
    updateUser,
    db // Exporta a instância do db se precisar em outros lugares
};