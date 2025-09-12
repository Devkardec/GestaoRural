const admin = require('firebase-admin');
const webpush = require('web-push');

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

async function fetchDueReminders(db, limit = 50) {
  const now = admin.firestore.Timestamp.now();
  const snap = await db
    .collection('reminders')
    .where('scheduledAt', '<=', now)
    .orderBy('scheduledAt', 'asc')
    .limit(limit)
    .get();
  const docs = [];
  snap.forEach((d) => {
    const data = d.data();
    if (!data.notified) {
      docs.push({ id: d.id, ...data });
    }
  });
  return docs;
}

async function sendToUser(db, userId, notificationPayload) {
  const subDoc = await db.collection('subscriptions').doc(userId).get();
  if (!subDoc.exists) return { skipped: true, reason: 'no-subscription' };
  const subscription = subDoc.data();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(notificationPayload));
    return { ok: true };
  } catch (e) {
    console.error('Erro push user', userId, e.statusCode, e.message);
    if (e.statusCode === 410 || e.statusCode === 404) {
      try {
        await db.collection('subscriptions').doc(userId).delete();
      } catch (_) {}
      return { removed: true };
    }
    return { error: true, message: e.message };
  }
}

function inferTitle(type) {
  switch (type) {
    case 'task':
      return 'Tarefa';
    case 'application':
      return 'Aplicação Agendada';
    case 'payment-late':
      return 'Pagamento Atrasado';
    case 'vaccine':
      return 'Aplicação de Vacina';
    default:
      return 'Lembrete';
  }
}

function buildBody(r) {
  switch (r.type) {
    case 'task':
      return r.description || 'Você tem uma tarefa agora.';
    case 'application':
      return r.description || 'Hora da aplicação programada.';
    case 'payment-late':
      return r.description || 'Um pagamento está atrasado.';
    case 'vaccine':
      return r.description || 'Vacinação programada para agora.';
    default:
      return r.description || 'Lembrete ativo.';
  }
}

function buildUrl(r) {
  switch (r.type) {
    case 'task':
      return '/?focus=tasks';
    case 'application':
      return '/?focus=applications';
    case 'payment-late':
      return '/?focus=payments';
    case 'vaccine':
      return '/?focus=vaccines';
    default:
      return '/';
  }
}

async function processReminders(db) {
  ensureVapidLocal();
  const due = await fetchDueReminders(db);
  if (!due.length) return { processed: 0, sent: 0 };
  let sent = 0;
  for (const r of due) {
    const title = r.title || inferTitle(r.type);
    const body = r.body || buildBody(r);
    const url = r.url || buildUrl(r);
    const payload = {
      notification: {
        title,
        body,
        tag: r.type || 'reminder',
        icon: 'assets/img/faviconsf.png',
        badge: 'assets/img/faviconsf.png',
        data: { url, type: r.type || 'reminder', refId: r.refId || r.id },
      },
    };
    const result = await sendToUser(db, r.userId, payload);
    if (result.ok) {
      sent++;
      await db
        .collection('reminders')
        .doc(r.id)
        .set(
          { notified: true, notifiedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
    }
  }
  return { processed: due.length, sent };
}

module.exports = { processReminders };
