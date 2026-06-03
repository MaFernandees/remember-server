const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── VAPID ────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = 'BGOAHouwntDKP1efv8zsURVxpokIW2xgwEO7QKvs_SB8MVC6el8q7kssMSMuyzeamU9wVy2KZfO-L4vo6aF_36k';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'Y7mlTq-9q7ufEEkTPn_dWssItiRLov_iOZC77woiIOI';

webpush.setVapidDetails(
  'mailto:marcos.fernandes16@hotmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// ── ANTHROPIC ────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── STORES ───────────────────────────────────────────────────
const subscriptions = new Map();
const scheduledReminders = new Map();

// ── ENDPOINTS ────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  status: 'Remember Server ok!',
  users: subscriptions.size,
  reminders: scheduledReminders.size
}));

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
    res.json({ success: true });
  } catch (e) {
    console.error("Erro push:", e.message);
    if (e.statusCode === 410) subscriptions.delete(userId);
    res.status(500).json({ error: e.message });
  }
});

// ── PARSE REMINDER VIA CLAUDE ─────────────────────────────────
app.post('/parse-reminder', async (req, res) => {
  const { text, nowISO } = req.body;
  if (!text) return res.status(400).json({ error: 'text obrigatório' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada no servidor' });
  }

  const prompt = `Você é um interpretador de lembretes em português brasileiro. Interprete o comando e retorne APENAS JSON válido, sem markdown, sem explicações.

DATA E HORA ATUAL EM BRASÍLIA (GMT-3): ${nowISO}

COMANDO: "${text}"

REGRAS OBRIGATÓRIAS:
1. "daqui X horas/minutos" ou "a partir de X horas" = hora atual + X (calcule com base no horário acima)
2. "X da tarde" = X+12h  →  6 da tarde = 18:00, 3 da tarde = 15:00
3. "X da noite" = X+12h se X>=6  →  8 da noite = 20:00, 10 da noite = 22:00
   "X da noite" = X se X<=5  →  1 da noite = 01:00 (madrugada)
   "12 da noite" = 00:00 (meia-noite)
4. "X da manhã" = X sem alteração  →  8 da manhã = 08:00
5. "e meia" = +30min  →  duas e meia da tarde = 14:30
6. "e quinze" = +15min
7. Números por extenso: uma=1, duas=2, três=3, quatro=4, cinco=5, seis=6, sete=7, oito=8, nove=9, dez=10, onze=11, doze=12
8. "hoje" = data de hoje; "amanhã" = data de amanhã; "depois de amanhã" = daqui 2 dias
9. "dia N" sem mês = próximo dia N futuro (se já passou no mês atual, use próximo mês)
10. "dia N de mês" = data exata (se já passou em ${new Date().getFullYear()}, use ${new Date().getFullYear() + 1})
11. Dias da semana = próxima ocorrência futura (ex: "sexta" = próxima sexta-feira)
12. "me lembra às X" = notify_time = X (horário do aviso, diferente do evento)
13. "me lembra X horas antes" = notify_time = horario_lembrete - X horas
14. "um dia antes" = notify_date = data_lembrete - 1 dia, notify_time = "09:00"
15. "uma semana antes" = notify_date = data_lembrete - 7 dias, notify_time = "09:00"
16. Se sem instrução de aviso: notify_date = data_lembrete, notify_time = horario_lembrete
17. tarefa = descrição limpa SEM datas, horários, "amanhã", "hoje", "me lembra", etc.
18. emoji = escolha o mais adequado: 🏥 saúde/médico, 💼 trabalho/reunião, 📞 ligar, 🎂 aniversário/festa, 🛒 compras, 💪 academia/treino, 📚 estudo/aula, ✈️ viagem, 💰 pagamento, 🔔 outros

RETORNE EXATAMENTE ESTE JSON:
{
  "tarefa": "descrição da tarefa",
  "data_lembrete": "YYYY-MM-DD",
  "horario_lembrete": "HH:MM",
  "notify_date": "YYYY-MM-DD",
  "notify_time": "HH:MM",
  "antecedencia": "descrição do aviso (ex: 'às 09:00', 'no momento', '1 dia antes')",
  "emoji": "emoji"
}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text.trim();
    // Extrai JSON mesmo que venha com texto extra
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Resposta não contém JSON válido');

    const parsed = JSON.parse(jsonMatch[0]);

    // Valida campos obrigatórios
    const required = ['tarefa','data_lembrete','horario_lembrete','notify_date','notify_time','antecedencia','emoji'];
    for (const f of required) {
      if (!parsed[f]) throw new Error(`Campo ausente: ${f}`);
    }

    console.log(`[parse-reminder] "${text}" → ${parsed.data_lembrete} ${parsed.horario_lembrete}`);
    res.json(parsed);

  } catch (e) {
    console.error('[parse-reminder] erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SCHEDULE REMINDER ─────────────────────────────────────────
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

app.delete('/schedule-reminder/:userId/:reminderId', (req, res) => {
  const key = `${req.params.userId}__${req.params.reminderId}`;
  scheduledReminders.delete(key);
  res.json({ success: true });
});

// ── CRON: dispara lembretes a cada minuto ─────────────────────
cron.schedule('* * * * *', async () => {
  const now = Date.now();
  for (const [key, reminder] of scheduledReminders.entries()) {
    if (reminder.fired) continue;
    if (new Date(reminder.notifyAt).getTime() > now) continue;
    reminder.fired = true;
    const sub = subscriptions.get(reminder.userId);
    if (!sub) continue;
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title: reminder.title, body: reminder.body }));
      console.log(`[cron] push disparado: key=${key}`);
    } catch (e) {
      console.error(`[cron] erro push key=${key}:`, e.message);
      if (e.statusCode === 410) subscriptions.delete(reminder.userId);
    }
  }
  const oneHourAgo = Date.now() - 3600000;
  for (const [key, r] of scheduledReminders.entries()) {
    if (r.fired && new Date(r.notifyAt).getTime() < oneHourAgo) scheduledReminders.delete(key);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
