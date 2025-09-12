const admin = require('firebase-admin');
const webpush = require('web-push');

// Firebase Admin init (reuse across invocations)
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (e) {
    console.error('Erro ao inicializar Firebase Admin:', e);
  }
}
const db = admin.firestore();

// Configura web-push com chaves VAPID vindas de variáveis de ambiente
function ensureVapid() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    throw new Error('VAPID_PUBLIC_KEY ou VAPID_PRIVATE_KEY não definidos nas variáveis de ambiente.');
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:suporte@agrocultive.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    ensureVapid();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { userId, title, body, url, type, refId } = payload;
  if (!userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'userId é obrigatório' }) };
  }

  try {
    const subDoc = await db.collection('subscriptions').doc(userId).get();
    if (!subDoc.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Subscription não encontrada para userId.' }) };
    }
    const subscription = subDoc.data();

    const notificationPayload = {
      notification: {
        title: title || 'AgroCultive',
        body: body || 'Você tem uma nova atualização.',
        tag: type || 'generic',
        icon: 'assets/img/faviconsf.png',
        badge: 'assets/img/faviconsf.png',
        data: {
          url: url || '/',
          type: type || 'generic',
          refId: refId || null
        }
      }
    };

    console.log('Enviando push para endpoint:', subscription.endpoint);
    try {
      await webpush.sendNotification(subscription, JSON.stringify(notificationPayload));
    } catch (pushErr) {
      console.error('Erro webpush.sendNotification:', pushErr && pushErr.stack || pushErr);
      throw pushErr;
    }
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e) {
  console.error('Falha ao enviar push (catch externo):', e && e.stack || e);
    // Se subscription inválida/expirada (410/404) podemos remover
    if (e.statusCode === 410 || e.statusCode === 404) {
      try { await db.collection('subscriptions').doc(userId).delete(); } catch(_){}
    }
  return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao enviar push', details: e.message, code: e.statusCode || null, stack: e.stack?.split('\n').slice(0,4) }) };
  }
};
