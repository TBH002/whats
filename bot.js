/**
 * ╔══════════════════════════════════════════════════════╗
 * ║    BOT WHATSAPP — FORTNITE ITEM SHOP                 ║
 * ║    QR via Web — Railway Edition                      ║
 * ╚══════════════════════════════════════════════════════╝
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom }  = require('@hapi/boom');
const cron      = require('node-cron');
const axios     = require('axios');
const fs        = require('fs');
const path      = require('path');
const pino      = require('pino');
const http      = require('http');
const qrcode    = require('qrcode');

// ─── CONFIGURACIÓN ───────────────────────────────────────
const CONFIG = {
  SHOP_URL:     process.env.SHOP_URL      || 'https://tbh002.infinityfree.me/item-shop.html?i=1',
  CREATOR_CODE: process.env.CREATOR_CODE  || 'Mr.TBH002',
  OWNER:        process.env.OWNER_NUMBER  || '527298635616',
  CRON_HORA:    process.env.CRON_HORA     || '0 0 * * *',
  PORT:         process.env.PORT          || 3000,
  FORTNITE_API: 'https://fortnite-api.com/v2/shop?language=es-419',
  AUTH_PATH:    '/tmp/wa_auth',
  get GRUPOS() {
    const g = process.env.GRUPOS || '';
    return g ? g.split(',').map(s => s.trim()).filter(Boolean) : [];
  }
};

let sock        = null;
let currentQR   = null;
let isConnected = false;

// ─── SERVIDOR HTTP PARA VER QR ───────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.url === '/qr' || req.url === '/') {
    if (isConnected) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><body style="background:#0a0a0a;color:#4dcc6a;font-family:sans-serif;text-align:center;padding:50px">
        <h1>✅ Bot Conectado</h1>
        <p>WhatsApp vinculado correctamente.</p>
        <p>Envía <b>!grupos</b> por WhatsApp para obtener los IDs de tus grupos.</p>
      </body></html>`);
      return;
    }
    if (!currentQR) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;text-align:center;padding:50px">
        <h1>⏳ Generando QR...</h1>
        <p>Espera unos segundos y recarga la página.</p>
        <script>setTimeout(()=>location.reload(), 3000)</script>
      </body></html>`);
      return;
    }
    // Generar QR como imagen
    const qrDataUrl = await qrcode.toDataURL(currentQR, { width: 300, margin: 2 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <meta http-equiv="refresh" content="30">
      <title>QR - Fortnite Bot</title>
    </head><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;text-align:center;padding:30px">
      <h2 style="color:#00d4ff">📱 Escanea con WhatsApp</h2>
      <img src="${qrDataUrl}" style="border:4px solid #8b2fff;border-radius:12px"/>
      <p style="color:#888">WhatsApp → ⋮ → Dispositivos vinculados → Vincular dispositivo</p>
      <p style="color:#f59e0b;font-size:12px">⚠️ El QR expira cada 30 segundos. La página se recarga sola.</p>
    </body></html>`);
    return;
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(CONFIG.PORT, () => {
  console.log(`🌐 Servidor QR corriendo en puerto ${CONFIG.PORT}`);
  console.log(`👉 Ve a la URL de Railway y agrega /qr al final para escanear`);
});

// ─── CONECTAR WHATSAPP ───────────────────────────────────
async function connectWA() {
  if (!fs.existsSync(CONFIG.AUTH_PATH)) {
    fs.mkdirSync(CONFIG.AUTH_PATH, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_PATH);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['FortniteBot', 'Chrome', '120.0.0'],
    connectTimeoutMs: 60000,
    retryRequestDelayMs: 2000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR   = qr;
      isConnected = false;
      console.log('📱 QR generado — abre la URL de Railway + /qr en tu navegador');
    }

    if (connection === 'open') {
      isConnected = true;
      currentQR   = null;
      console.log('✅ ¡Bot conectado a WhatsApp!');
      console.log(`📋 Grupos: ${CONFIG.GRUPOS.length}`);
      console.log(`⏰ Cron: ${CONFIG.CRON_HORA} UTC`);
      programarEnvio();
    }

    if (connection === 'close') {
      isConnected = false;
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode
        : lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`🔌 Desconectado (${code}). Reconectando: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(connectWA, 5000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const from = msg.key.remoteJid;
      const body = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text || '';
      const ownerJid = CONFIG.OWNER + '@s.whatsapp.net';
      if (from !== ownerJid) continue;
      await handleCommand(body.trim().toLowerCase(), from);
    }
  });
}

// ─── COMANDOS ────────────────────────────────────────────
async function handleCommand(cmd, from) {
  switch (cmd) {
    case '!ayuda':
      await send(from,
        `🤖 *Comandos:*\n\n!grupos → IDs de tus grupos\n!tienda → Envía ahora\n!test → Prueba\n!ayuda → Este menú`);
      break;

    case '!grupos': {
      try {
        const grupos = Object.keys(await sock.groupFetchAllParticipating());
        if (!grupos.length) { await send(from, 'No estás en ningún grupo.'); return; }
        let lista = `📋 *Grupos (${grupos.length}):*\n\n`;
        for (const id of grupos) {
          const meta = await sock.groupMetadata(id).catch(() => ({ subject: id }));
          lista += `• *${meta.subject}*\n\`${id}\`\n\n`;
        }
        lista += '➡️ Copia los IDs → Railway → Variables → GRUPOS\nSepara con coma.';
        await send(from, lista);
      } catch (e) {
        await send(from, '❌ Error: ' + e.message);
      }
      break;
    }

    case '!tienda':
      await send(from, '📤 Enviando tienda...');
      await enviarATodos();
      await send(from, '✅ ¡Listo!');
      break;

    case '!test': {
      const datos = await obtenerDatosTienda();
      await send(from, construirMensaje(datos));
      break;
    }
  }
}

// ─── HELPERS ─────────────────────────────────────────────
async function send(jid, texto) {
  try { await sock.sendMessage(jid, { text: texto }); }
  catch (e) { console.error('Error msg:', e.message); }
}

async function sendImg(jid, imgUrl, caption) {
  try {
    const res = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 15000 });
    await sock.sendMessage(jid, { image: Buffer.from(res.data), caption, mimetype: 'image/jpeg' });
    return true;
  } catch { return false; }
}

// ─── DATOS TIENDA ─────────────────────────────────────────
async function obtenerDatosTienda() {
  try {
    const res      = await axios.get(CONFIG.FORTNITE_API, { timeout: 10000 });
    const data     = res.data.data;
    const fechaStr = new Date(data.date).toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const entries = data.entries ?? [];
    let total = 0, nuevos = 0, salePronto = 0, precioMin = Infinity, imgDestacada = null;
    entries.forEach(e => {
      total++;
      if (e.banner?.backendValue === 'New') nuevos++;
      if (e.finalPrice) precioMin = Math.min(precioMin, e.finalPrice);
      if (e.outDate && (new Date(e.outDate) - Date.now()) / 3600000 <= 24) salePronto++;
      if (!imgDestacada && e.brItems?.[0]?.images?.featured)
        imgDestacada = e.brItems[0].images.featured;
    });
    const precioMinMXN = precioMin !== Infinity
      ? `desde $${((precioMin / 100) * 9.5).toFixed(0)} MXN` : 'desde $9.50 MXN';
    return { fechaStr, total, nuevos, salePronto, precioMinMXN, imgDestacada };
  } catch {
    return { fechaStr: new Date().toLocaleDateString('es-MX'),
             total: '?', nuevos: '?', salePronto: '?',
             precioMinMXN: 'desde $9.50 MXN', imgDestacada: null };
  }
}

function construirMensaje({ fechaStr, total, nuevos, salePronto, precioMinMXN }) {
  return `🎮 *FORTNITE ITEM SHOP*
📅 ${fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1)}

🛒 *${total}* items disponibles hoy
🟢 *${nuevos}* nuevas ofertas
🔴 *${salePronto}* se van pronto
💵 Precios ${precioMinMXN}

━━━━━━━━━━━━━━━━━━
💰 *Precios bajos en compras con V-Bucks*
¡No te quedes sin tu skin favorita!

⭐ *Apoya a tu creador de contenido*
🎯 Código de Creador: *${CONFIG.CREATOR_CODE}*
━━━━━━━━━━━━━━━━━━

🌐 *Ver tienda completa:*
${CONFIG.SHOP_URL}

_Úsalo antes de comprar en Fortnite_ 🙌`;
}

async function enviarATodos() {
  if (!CONFIG.GRUPOS.length) { console.log('⚠️ Sin grupos.'); return; }
  const datos   = await obtenerDatosTienda();
  const mensaje = construirMensaje(datos);
  let enviados  = 0;
  for (const id of CONFIG.GRUPOS) {
    try {
      const ok = datos.imgDestacada ? await sendImg(id, datos.imgDestacada, mensaje) : false;
      if (!ok) await send(id, mensaje);
      const meta = await sock.groupMetadata(id).catch(() => ({ subject: id }));
      console.log(`✅ → ${meta.subject}`);
      enviados++;
      await new Promise(r => setTimeout(r, 2500));
    } catch (e) { console.error(`❌ ${id}:`, e.message); }
  }
  console.log(`📤 ${enviados}/${CONFIG.GRUPOS.length} grupos`);
}

function programarEnvio() {
  cron.schedule(CONFIG.CRON_HORA, async () => {
    console.log(`🚀 Enviando tienda...`);
    await enviarATodos();
  }, { timezone: 'UTC' });
}

// ─── INICIAR ─────────────────────────────────────────────
console.log('🔄 Iniciando bot...');
console.log(`📌 ${CONFIG.SHOP_URL}`);
console.log(`🎯 ${CONFIG.CREATOR_CODE}`);
connectWA();
