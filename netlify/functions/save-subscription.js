const admin = require('firebase-admin');

// Initialize Firebase Admin SDK if not already initialized
// This check is important for Netlify Functions as they might reuse instances
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.error('Error initializing Firebase Admin SDK:', e);
        // It's crucial to return an error response if initialization fails
        // to prevent subsequent operations from failing silently.
        // However, for Netlify Functions, throwing an error here will
        // prevent the function from executing. The handler should catch it.
    }
}

const db = admin.firestore();

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { subscription, userId } = JSON.parse(event.body);

    if (!subscription) {
        return { statusCode: 400, body: 'Subscription object is missing.' };
    }

    try {
        const docRef = db.collection('subscriptions').doc(userId || subscription.endpoint);
        await docRef.set({
            ...subscription,
            userId: userId || null,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log('Subscription saved:', subscription.endpoint);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Subscription saved successfully.' })
        };
    } catch (error) {
        console.error('Error saving subscription:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to save subscription.', details: error.message })
        };
    }
};