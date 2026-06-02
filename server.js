const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Firebase init
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// Armazena subscriptions em memória
const subscriptions = new Map();

// Registra subscription do usuário
app.post('/register', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'Dados inválidos' });
  subscriptions.set(userId, subscription);
  console.log("Usuário registrado:", userId);
  res.json({ success: true });
});

// Envia notificação push via FCM
app.post('/notify', async (req, res) => {
  const { userId, title, body } = req.body;
  const subscription = subscriptions.get(userId);
  if (!subscription) return res.status(404).json({ error: 'Usuário não registrado' });

  try {
    // Usa FCM via endpoint da subscription
    const endpoint = subscription.endpoint;
    const fcmToken = endpoint.split('/').pop();

    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      webpush: {
        notification: {
          title,
          body,
          icon: '/icon-192.png',
          requireInteraction: true,
          vibrate: [300, 100, 300],
        },
        fcmOptions: { link: '/' }
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          priority: 'high',
          channelId: 'remember_channel',
          notificationCount: 1,
        }
      }
    });

    console.log("Notificação enviada para:", userId);
    res.json({ success: true });
  } catch (e) {
    console.error("Erro ao enviar:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'Remember Server rodando!', users: subscriptions.size }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
