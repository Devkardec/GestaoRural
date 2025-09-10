const admin = require('firebase-admin');

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.error('Error initializing Firebase Admin SDK:', e);
    }
}

const db = admin.firestore();
const messaging = admin.messaging();

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { userId, title, body, url } = JSON.parse(event.body);

    if (!userId) {
        return { statusCode: 400, body: 'User ID is required to send a test notification.' };
    }

    try {
        const docRef = db.collection('subscriptions').doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
            return { statusCode: 404, body: 'Subscription not found for this user.' };
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
                    // Replace with your actual PWA domain
                                        icon: 'https://agrocultivegestaorural.com.br/assets/img/faviconsf.png',
                    badge: 'https://agrocultivegestaorural.com.br/assets/img/faviconsf.png',
                    data: {
                        url: url || '/',
                    },
                },
            },
            token: subscription.endpoint, // Use the endpoint as token for FCM Web Push
        };

        const response = await messaging.send(message);
        console.log('Successfully sent test message:', response);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Test notification sent successfully.', response })
        };
    } catch (error) {
        console.error('Error sending test notification:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to send test notification.', details: error.message })
        };
    }
};
