/**
 * WACRM Backend — conexión real a WhatsApp vía código QR (whatsapp-web.js)
 * Envía mensajes individuales y masivos desde tu propio número de WhatsApp.
 *
 * IMPORTANTE:
 * - Esto usa una librería NO oficial que automatiza WhatsApp Web.
 * - WhatsApp puede suspender números que envíen spam o volumen muy alto
 *   en poco tiempo. Usa retrasos razonables entre mensajes (ya incluido).
 * - Para uso comercial serio y sin riesgo de baneo, considera migrar a la
 *   API oficial de Meta (WhatsApp Business Cloud API) más adelante.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let client = null;
let isReady = false;
let lastQR = null;
let myInfo = null;
let bulkRunning = false;
let lastError = null;
let qrReceivedAt = null;

/* ============================================================
   RESPUESTA AUTOMÁTICA — FLUJO DE COBRANZA (con handoff a humano)
   ============================================================ */
const DATA_FILE = path.join(__dirname, 'conversations.json');
let autoResponderEnabled = true;
let conversations = {}; // key: número limpio -> { step, data, status, name, messages: [] }

function loadConversations() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      conversations = raw.conversations || {};
      autoResponderEnabled = raw.autoResponderEnabled !== undefined ? raw.autoResponderEnabled : true;
    }
  } catch (e) {
    console.error('No se pudo cargar conversations.json:', e.message);
  }
}

let saveTimeout = null;
function saveConversations() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ conversations, autoResponderEnabled }, null, 2));
    } catch (e) {
      console.error('No se pudo guardar conversations.json:', e.message);
    }
  }, 500);
}

loadConversations();

// Textos del flujo (edítalos aquí si el banco pide otro guion)
const FLOW = {
  greeting: () => `Hola 👋, gracias por escribirnos. Somos el equipo de atención al cliente de *Santander Consumer*.\n\nPara ayudarte mejor, ¿nos podrías compartir tu número de *DNI*?`,
  askPaymentOption: () => `Gracias. Ahora cuéntanos, ¿cómo te gustaría regularizar tu deuda?\n\n1️⃣ Pago al contado\n2️⃣ Pago fraccionado\n3️⃣ Quiero consultar un descuento`,
  askBudget: () => `Perfecto. Por último, ¿con qué monto cuentas actualmente para abonar o liquidar tu deuda?`,
  handoff: () => `¡Gracias por la información! 🙌 Un asesor se pondrá en contacto contigo en breve para continuar con los detalles de tu pago.`
};

function summarize(number) {
  const c = conversations[number];
  if (!c) return null;
  return {
    number,
    status: c.status,
    step: c.step,
    data: c.data,
    lastMessage: c.messages[c.messages.length - 1] || null,
    messageCount: c.messages.length,
    updatedAt: c.updatedAt
  };
}

function getOrCreateConvo(number) {
  if (!conversations[number]) {
    conversations[number] = { step: 0, data: {}, status: 'bot', messages: [], updatedAt: Date.now() };
  }
  return conversations[number];
}

function attachMessageHandler() {
  client.on('message', async (msg) => {
    if (msg.fromMe) return;
    const number = msg.from; // ej: '51987654321@c.us'
    const convo = getOrCreateConvo(number);
    convo.messages.push({ from: 'cliente', text: msg.body, at: Date.now() });
    convo.updatedAt = Date.now();
    saveConversations();
    io.emit('conversation-update', summarize(number));

    if (!autoResponderEnabled || convo.status !== 'bot') {
      return; // bot apagado globalmente, o esta conversación ya la lleva un asesor
    }

    let reply = null;
    if (convo.step === 0) {
      reply = FLOW.greeting();
      convo.step = 1;
    } else if (convo.step === 1) {
      convo.data.dni = msg.body.trim();
      reply = FLOW.askPaymentOption();
      convo.step = 2;
    } else if (convo.step === 2) {
      convo.data.paymentOption = msg.body.trim();
      reply = FLOW.askBudget();
      convo.step = 3;
    } else if (convo.step === 3) {
      convo.data.budget = msg.body.trim();
      reply = FLOW.handoff();
      convo.step = 4;
      convo.status = 'waiting_agent'; // el bot ya recopiló los datos, pasa a un asesor humano
    } else {
      return;
    }

    if (reply) {
      try {
        await client.sendMessage(number, reply);
        convo.messages.push({ from: 'bot', text: reply, at: Date.now() });
        convo.updatedAt = Date.now();
        saveConversations();
        io.emit('conversation-update', summarize(number));
      } catch (e) {
        console.error('Error enviando respuesta automática:', e.message);
      }
    }
  });
}

function initClient() {
  console.log('⏳ Iniciando navegador interno (Chromium) para conectar con WhatsApp Web...');
  console.log('   Esto puede tardar hasta 1-2 minutos la primera vez.');

  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'wacrm-device-01' }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    }
  });

  client.on('qr', async (qr) => {
    lastQR = await qrcode.toDataURL(qr);
    qrReceivedAt = Date.now();
    isReady = false;
    io.emit('qr', lastQR);
    io.emit('status', { connected: false });
    console.log('📱 Código QR generado. Escanéalo desde WhatsApp (Dispositivos vinculados).');
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Cargando WhatsApp Web: ${percent}% - ${message}`);
    io.emit('loading', { percent, message });
  });

  client.on('ready', () => {
    isReady = true;
    lastQR = null;
    lastError = null;
    myInfo = client.info;
    io.emit('status', { connected: true, number: myInfo?.wid?.user || null });
    console.log('✅ WhatsApp conectado:', myInfo?.wid?.user);
    attachMessageHandler();
  });

  client.on('authenticated', () => {
    console.log('🔐 Autenticado correctamente');
  });

  client.on('auth_failure', (msg) => {
    lastError = 'Fallo de autenticación: ' + msg;
    io.emit('backend-error', { message: lastError });
    console.error('❌ Fallo de autenticación:', msg);
  });

  client.on('disconnected', (reason) => {
    isReady = false;
    myInfo = null;
    io.emit('status', { connected: false });
    console.log('❌ Desconectado:', reason);
  });

  client.initialize().catch((err) => {
    lastError = 'No se pudo iniciar el navegador interno: ' + err.message;
    io.emit('backend-error', { message: lastError });
    console.error('❌ ERROR al iniciar Puppeteer/Chromium:');
    console.error(err);
    console.error('\n💡 Soluciones comunes:');
    console.error('   1) Instala Google Chrome en tu computadora.');
    console.error('   2) Si usas antivirus/Windows Defender, agrega una excepción para node.exe y Chromium.');
    console.error('   3) Ejecuta: npm install (de nuevo) para asegurarte de que Puppeteer descargó Chromium.');
    console.error('   4) Si sigue fallando, prueba: npm install puppeteer --save y reinicia.\n');
  });

  // Si en 25s no llegó QR ni error, avisamos igual (probablemente lento, no roto)
  setTimeout(() => {
    if (!lastQR && !isReady && !lastError) {
      io.emit('backend-slow', { message: 'El navegador interno sigue iniciando. Si pasan más de 2 minutos sin QR, revisa la terminal para ver errores.' });
    }
  }, 25000);
}

initClient();

io.on('connection', (socket) => {
  socket.emit('status', { connected: isReady, number: myInfo?.wid?.user || null });
  if (lastQR && !isReady) socket.emit('qr', lastQR);
});

// ---------- API: estado ----------
app.get('/api/status', (req, res) => {
  res.json({ connected: isReady, number: myInfo?.wid?.user || null, lastError });
});

// ---------- API: reiniciar sesión / cerrar sesión ----------
app.post('/api/logout', async (req, res) => {
  try {
    if (client) await client.logout();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- API: enviar mensaje individual ----------
app.post('/api/send-message', async (req, res) => {
  const { number, message } = req.body;
  if (!isReady) return res.status(400).json({ error: 'WhatsApp no está conectado. Escanea el código QR primero.' });
  if (!number || !message) return res.status(400).json({ error: 'Falta número o mensaje.' });

  try {
    const clean = String(number).replace(/\D/g, '');
    const chatId = clean.includes('@c.us') ? clean : `${clean}@c.us`;

    await client.sendMessage(chatId, message);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- API: envío masivo con retraso aleatorio ----------
app.post('/api/send-bulk', async (req, res) => {
  const { numbers, message, minDelay = 3, maxDelay = 9 } = req.body;

  if (!isReady) return res.status(400).json({ error: 'WhatsApp no está conectado. Escanea el código QR primero.' });
  if (bulkRunning) return res.status(400).json({ error: 'Ya hay un envío masivo en curso.' });
  if (!Array.isArray(numbers) || numbers.length === 0) return res.status(400).json({ error: 'Debes enviar al menos un número.' });

  bulkRunning = true;
  res.json({ started: true, total: numbers.length });

  let sent = 0, failed = 0;

  for (const rawNumber of numbers) {
    const clean = String(rawNumber).trim().replace(/\D/g, '');
    if (!clean) continue;

    try {
      const chatId = `${clean}@c.us`;
      await client.sendMessage(chatId, message);
      sent++;
      io.emit('bulk-progress', { number: clean, status: 'sent', sent, failed, total: numbers.length });
    } catch (e) {
      failed++;
      io.emit('bulk-progress', { number: clean, status: 'failed', error: e.message, sent, failed, total: numbers.length });
    }

    const delayMs = (Math.random() * (maxDelay - minDelay) + minDelay) * 1000;
    await new Promise((r) => setTimeout(r, delayMs));
  }

  bulkRunning = false;
  io.emit('bulk-done', { sent, failed, total: numbers.length });
});

// ---------- API: estado del bot de respuesta automática ----------
app.get('/api/autoresponder', (req, res) => {
  res.json({ enabled: autoResponderEnabled });
});

app.post('/api/autoresponder/toggle', (req, res) => {
  autoResponderEnabled = !!req.body.enabled;
  saveConversations();
  io.emit('autoresponder-status', { enabled: autoResponderEnabled });
  res.json({ enabled: autoResponderEnabled });
});

// ---------- API: listar todas las conversaciones ----------
app.get('/api/conversations', (req, res) => {
  const list = Object.keys(conversations)
    .map(summarize)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(list);
});

// ---------- API: ver el detalle (mensajes completos) de una conversación ----------
app.get('/api/conversations/:number', (req, res) => {
  const convo = conversations[req.params.number];
  if (!convo) return res.status(404).json({ error: 'Conversación no encontrada' });
  res.json({ number: req.params.number, ...convo });
});

// ---------- API: un asesor humano toma el control (pausa el bot en esa conversación) ----------
app.post('/api/conversations/:number/takeover', (req, res) => {
  const convo = getOrCreateConvo(req.params.number);
  convo.status = 'human';
  convo.updatedAt = Date.now();
  saveConversations();
  io.emit('conversation-update', summarize(req.params.number));
  res.json({ success: true });
});

// ---------- API: reactivar el bot en esa conversación ----------
app.post('/api/conversations/:number/resume-bot', (req, res) => {
  const convo = getOrCreateConvo(req.params.number);
  convo.status = 'bot';
  convo.updatedAt = Date.now();
  saveConversations();
  io.emit('conversation-update', summarize(req.params.number));
  res.json({ success: true });
});

// ---------- API: el asesor responde manualmente dentro de una conversación ----------
app.post('/api/conversations/:number/reply', async (req, res) => {
  const { message } = req.body;
  if (!isReady) return res.status(400).json({ error: 'WhatsApp no está conectado.' });
  if (!message) return res.status(400).json({ error: 'Falta el mensaje.' });

  try {
    const number = req.params.number;
    await client.sendMessage(number, message);
    const convo = getOrCreateConvo(number);
    convo.messages.push({ from: 'asesor', text: message, at: Date.now() });
    convo.updatedAt = Date.now();
    saveConversations();
    io.emit('conversation-update', summarize(number));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 WACRM backend corriendo en http://localhost:${PORT}`);
  console.log(`   Abre esa URL en tu navegador y ve a "Dispositivos" para vincular tu WhatsApp.\n`);
});
