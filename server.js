const express = require('express');
const webpush = require('web-push');
const cors = require('cors');

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

const subscriptions = new Map();

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

app.get('/vapid-public-key', (req, res) => res.json({ key: VAPID_PUBLIC_KEY }));
app.get('/', (req, res) => res.json({ status: 'Remember Server ok!', users: subscriptions.size }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
