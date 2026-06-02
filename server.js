const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const VAPID_PUBLIC_KEY = 'BGOAHouwntDKP1efv8zsURVxpokIW2xgwEO7QKvs_SB8MVC6el8q7kssMSMuyzeamU9wVy2KZfO-L4vo6aF_36k';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'Y7mlTq-9q7ufEEkTPn_dWssItiRLov_iOZC77woiIOI';

webpush.setVapidDetails(
  'mailto:marcos.fernandes16@hotmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// userId -> PushSubscription JSON
const subscriptions = new Map();

// `${userId}__${reminderId}` -> { userId, notifyAt, title, body, fired }
const scheduledReminders = new Map();

// ── ENDPOINTS ────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'Remember Server ok!', users: subscriptions.size, reminders: scheduledReminders.size }));

app.get('/vapid-public-key', (req, res) => res.json({ key: VAPID_PUBLIC_KEY }));

app.post('/register', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'Dados inválidos' });
  subscriptions.set(userId, subscription);
  console.log("Registrado:", userId, "Total:", subscriptions.size);
  res.json({ success: true });
});

app.post('/notify', async (req, res) => {
  const { userId, title, body } = req.body;
  const subscription = subscriptions.get(userId);
  if (!subscription) return res.status(404).json({ error: 'Não registrado' });
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body }));
    console.log("Push enviado:", title);
    res.json({ success: true });
  } catch (e) {
    console.error("Erro:", e.message);
    if (e.statusCode === 410) subscriptions.delete(userId);
    res.status(500).json({ error: e.message });
  }
});

// Agenda lembrete no servidor para disparo mesmo com app fechado
app.post('/schedule-reminder', (req, res) => {
  const { userId, reminderId, notifyAt, title, body } = req.body;
  if (!userId || !reminderId || !notifyAt) {
    return res.status(400).json({ error: 'userId, reminderId e notifyAt são obrigatórios' });
  }
  const key = `${userId}__${reminderId}`;
  scheduledReminders.set(key, { userId, notifyAt, title, body, fired: false });
  console.log(`[schedule] key=${key} notifyAt=${notifyAt} total=${scheduledReminders.size}`);
  res.json({ success: true });
});

// Remove lembrete agendado quando usuário deleta
app.delete('/schedule-reminder/:userId/:reminderId', (req, res) => {
  const key = `${req.params.userId}__${req.params.reminderId}`;
  scheduledReminders.delete(key);
  console.log(`[unschedule] key=${key}`);
  res.json({ success: true });
});

// ── CRON: verifica e dispara lembretes a cada minuto ─────────
cron.schedule('* * * * *', async () => {
  const now = Date.now();
  for (const [key, reminder] of scheduledReminders.entries()) {
    if (reminder.fired) continue;
    if (new Date(reminder.notifyAt).getTime() > now) continue;

    reminder.fired = true;
    const sub = subscriptions.get(reminder.userId);
    if (!sub) {
      console.log(`[cron] sem subscription para userId=${reminder.userId}`);
      continue;
    }

    try {
      await webpush.sendNotification(sub, JSON.stringify({
        title: reminder.title,
        body: reminder.body,
      }));
      console.log(`[cron] push disparado: key=${key}`);
    } catch (e) {
      console.error(`[cron] erro push key=${key}:`, e.message);
      if (e.statusCode === 410) subscriptions.delete(reminder.userId);
    }
  }

  // Limpa disparados há mais de 1h para não acumular memória
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [key, reminder] of scheduledReminders.entries()) {
    if (reminder.fired && new Date(reminder.notifyAt).getTime() < oneHourAgo) {
      scheduledReminders.delete(key);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
