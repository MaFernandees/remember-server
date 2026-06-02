const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Firebase init
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = new Map(); // armazena tokens e lembretes em memória

// Registra token do usuário
app.post('/register', (req, res) => {
  const { token, userId } = req.body;
  if (!token || !userId) return res.status(400).json({ error: 'Token e userId obrigatórios' });
  db.set(userId, { token, reminders: [] });
  res.json({ success: true });
});

// Salva lembrete
app.post('/reminder', (req, res) => {
  const { userId, reminder } = req.body;
  if (!userId || !reminder) return res.status(400).json({ error: 'Dados inválidos' });
  const user = db.get(userId) || { token: null, reminders: [] };
  user.reminders.push(reminder);
  db.set(userId, user);
  res.json({ success: true });
});

// Dispara notificação
app.post('/notify', async (req, res) => {
  const { token, title, body } = req.body;
  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      android: { priority: 'high', notification: { sound: 'default', priority: 'high', channelId: 'remember' } },
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'Remember Server rodando!' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
