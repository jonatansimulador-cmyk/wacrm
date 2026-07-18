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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 WACRM backend corriendo en http://localhost:${PORT}`);
  console.log(`   Abre esa URL en tu navegador y ve a "Dispositivos" para vincular tu WhatsApp.\n`);
});
