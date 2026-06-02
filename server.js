const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Firebase init
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// Armazena tokens FCM por userId
const tokens = new Map();

// Registra token FCM do usuário
app.post('/register', (req, res) => {
  const { userId, fcmToken } = req.body;
  if (!userId || !fcmToken) return res.status(400).json({ error: 'userId e fcmToken obrigatórios' });
  tokens.set(userId, fcmToken);
  console.log("Token registrado para:", userId);
  res.json({ success: true });
});

// Envia notificação push via FCM
app.post('/notify', async (req, res) => {
  const { userId, fcmToken, title, body } = req.body;
  const token = fcmToken || tokens.get(userId);
  if (!token) return res.status(404).json({ error: 'Token não encontrado' });

  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      webpush: {
        notification: {
          title, body,
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
        }
      }
    });
    console.log("Notificação enviada:", title);
    res.json({ success: true });
  } catch (e) {
    console.error("Erro:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.json({ 
  status: 'Remember Server rodando!', 
  users: tokens.size 
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
