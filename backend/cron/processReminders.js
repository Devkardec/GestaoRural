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
  const baseQuery = db
    .collection('reminders')
    .where('scheduledAt', '<=', now)
    .orderBy('scheduledAt', 'asc')
    .limit(limit);
  const snap = await baseQuery.get();
  const rawCount = snap.size;
  const docs = [];
  snap.forEach((d) => {
    const data = d.data();
    if (!data.notified) {
      docs.push({ id: d.id, ...data });
    }
  });
  console.log(`[cron] Query reminders <= now: raw=${rawCount} pendingAfterFilter=${docs.length}`);
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

async function processReminders(db, { debug = false } = {}) {
  ensureVapidLocal();
  const due = await fetchDueReminders(db);
  if (!due.length) {
    if (debug) console.log('[cron] Nenhum lembrete devido neste ciclo.');
    return { processed: 0, sent: 0, items: [] };
  }
  let sent = 0;
  const items = [];
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
    if (debug) console.log('[cron] Enviando lembrete', r.id, 'userId=', r.userId, 'type=', r.type, 'scheduledAt=', r.scheduledAt?.toDate?.());
    const result = await sendToUser(db, r.userId, payload);
    items.push({ id: r.id, userId: r.userId, result });
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
  console.log(`[cron] Ciclo concluído processed=${due.length} sent=${sent}`);
  return { processed: due.length, sent, items };
}

module.exports = { processReminders };
