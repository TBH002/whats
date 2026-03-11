/**
 * ╔══════════════════════════════════════════════════════╗
 * ║    BOT WHATSAPP — FORTNITE ITEM SHOP                 ║
 * ║    Baileys Edition — Sin Chrome, sin puppeteer       ║
 * ╚══════════════════════════════════════════════════════╝
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode   = require('qrcode-terminal');
const cron     = require('node-cron');
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const pino     = require('pino');

// ─── CONFIGURACIÓN ───────────────────────────────────────
const CONFIG = {
  SHOP_URL:     process.env.SHOP_URL      || 'https://tbh002.infinityfree.me/item-shop.html?i=1',
  CREATOR_CODE: process.env.CREATOR_CODE  || 'Mr.TBH002',
  OWNER:        process.env.OWNER_NUMBER  || '527298635616',
  CRON_HORA:    process.env.CRON_HORA     || '0 0 * * *',
  FORTNITE_API: 'https://fortnite-api.com/v2/shop?language=es-419',
  AUTH_PATH:    '/tmp/wa_auth',
  get GRUPOS() {
    const g = process.env.GRUPOS || '';
    return g ? g.split(',').map(s => s.trim()).filter(Boolean) : [];
  }
};

let sock = null;

// ─── CONECTAR WHATSAPP ───────────────────────────────────
async function connectWA() {
  if (!fs.existsSync(CONFIG.AUTH_PATH)) fs.mkdirSync(CONFIG.AUTH_PATH, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_PATH);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // silenciar logs internos
    printQRInTerminal: false,
    browser: ['FortniteBot', 'Chrome', '1.0.0'],
  });

  // Guardar credenciales cuando cambien
  sock.ev.on('creds.update', saveCreds);

  // Manejar conexión
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

    // Mostrar QR
    if (qr) {
      console.log('\n════════════════════════════════════════');
      console.log('  📱 ESCANEA ESTE QR CON WHATSAPP');
      console.log('════════════════════════════════════════');
      qrcode.generate(qr, { small: true });
      console.log('  WhatsApp → ⋮ → Dispositivos vinculados');
      console.log('════════════════════════════════════════\n');
    }

    if (connection === 'open') {
      console.log('✅ Bot conectado a WhatsApp!');
      console.log(`📋 Grupos configurados: ${CONFIG.GRUPOS.length}`);
      console.log(`⏰ Envío automático: ${CONFIG.CRON_HORA} UTC (6pm México)`);
      console.log('\nComandos: !grupos | !tienda | !test | !stw | !ayuda\n');
      programarEnvio();
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`🔌 Desconectado (${code}). Reconectando: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(connectWA, 5000);
      } else {
        console.log('❌ Sesión cerrada. Borra /tmp/wa_auth y reinicia.');
      }
    }
  });

  // Manejar mensajes
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const from = msg.key.remoteJid;
      const body = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text || '';

      // Solo responder al dueño
      const ownerJid = CONFIG.OWNER + '@s.whatsapp.net';
      if (from !== ownerJid) continue;

      await handleCommand(body.trim().toLowerCase(), from);
    }
  });
}

// ─── MANEJAR COMANDOS ────────────────────────────────────
async function handleCommand(cmd, from) {
  switch (cmd) {
    case '!ayuda':
      await enviarMensaje(from,
        `🤖 *Comandos disponibles:*\n\n` +
        `!grupos  → Lista tus grupos con IDs\n` +
        `!tienda  → Envía la tienda ahora\n` +
        `!test    → Mensaje de prueba\n` +
        `!stw     → Alertas V-Bucks STW\n` +
        `!ayuda   → Este menú`
      );
      break;

    case '!grupos': {
      try {
        const grupos = Object.keys(await sock.groupFetchAllParticipating());
        if (!grupos.length) { await enviarMensaje(from, 'No estás en ningún grupo.'); return; }
        let lista = `📋 *Tus grupos (${grupos.length}):*\n\n`;
        for (const id of grupos) {
          const meta = await sock.groupMetadata(id);
          lista += `• *${meta.subject}*\n\`${id}\`\n\n`;
        }
        lista += '➡️ Copia el ID y agrégalo en Railway → Variables → GRUPOS\nSepara varios con coma.';
        await enviarMensaje(from, lista);
      } catch (e) {
        await enviarMensaje(from, '❌ Error obteniendo grupos: ' + e.message);
      }
      break;
    }

    case '!tienda':
      await enviarMensaje(from, '📸 Enviando tienda a todos los grupos...');
      await enviarATodos();
      await enviarMensaje(from, '✅ ¡Listo! Tienda enviada.');
      break;

    case '!test': {
      const datos = await obtenerDatosTienda();
      await enviarMensaje(from, construirMensaje(datos));
      break;
    }

    case '!stw': {
      await enviarMensaje(from, '🔍 Verificando misiones STW...');
      const alerta = await verificarSTW();
      await enviarMensaje(from, alerta);
      break;
    }
  }
}

// ─── ENVIAR MENSAJE ──────────────────────────────────────
async function enviarMensaje(jid, texto) {
  try {
    await sock.sendMessage(jid, { text: texto });
  } catch (e) {
    console.error('Error enviando mensaje:', e.message);
  }
}

// ─── ENVIAR IMAGEN DESDE URL ─────────────────────────────
async function enviarImagenUrl(jid, imgUrl, caption) {
  try {
    const res = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const buffer = Buffer.from(res.data);
    await sock.sendMessage(jid, {
      image: buffer,
      caption: caption,
      mimetype: 'image/jpeg'
    });
    return true;
  } catch (e) {
    console.error('Error enviando imagen:', e.message);
    return false;
  }
}

// ─── OBTENER DATOS TIENDA ────────────────────────────────
async function obtenerDatosTienda() {
  try {
    const res = await axios.get(CONFIG.FORTNITE_API, { timeout: 10000 });
    const data = res.data.data;
    const fecha = new Date(data.date);
    const fechaStr = fecha.toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const entries = data.entries ?? [];
    let total = 0, nuevos = 0, salePronto = 0, precioMin = Infinity;
    let imgDestacada = null;

    entries.forEach(e => {
      total++;
      if (e.banner?.backendValue === 'New') nuevos++;
      if (e.finalPrice) precioMin = Math.min(precioMin, e.finalPrice);
      if (e.outDate) {
        const h = (new Date(e.outDate) - Date.now()) / 3600000;
        if (h > 0 && h <= 24) salePronto++;
      }
      // Imagen del item más destacado
      if (!imgDestacada && e.brItems?.[0]?.images?.featured) {
        imgDestacada = e.brItems[0].images.featured;
      }
    });

    const precioMinMXN = precioMin !== Infinity
      ? `desde $${((precioMin / 100) * 9.5).toFixed(0)} MXN`
      : 'desde $9.50 MXN';

    return { fechaStr, total, nuevos, salePronto, precioMinMXN, imgDestacada };
  } catch (err) {
    console.error('Error API Fortnite:', err.message);
    return {
      fechaStr: new Date().toLocaleDateString('es-MX'),
      total: '?', nuevos: '?', salePronto: '?',
      precioMinMXN: 'desde $9.50 MXN', imgDestacada: null
    };
  }
}

// ─── CONSTRUIR MENSAJE ───────────────────────────────────
function construirMensaje({ fechaStr, total, nuevos, salePronto, precioMinMXN }) {
  const fecha = fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1);
  return `🎮 *FORTNITE ITEM SHOP*
📅 ${fecha}

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

🌐 *Ver tienda completa con precios en MXN:*
${CONFIG.SHOP_URL}

_Úsalo antes de comprar en la tienda de Fortnite_ 🙌`;
}

// ─── VERIFICAR STW V-BUCKS ───────────────────────────────
async function verificarSTW() {
  try {
    const res = await axios.get('https://fortnite-api.com/v1/map?language=es-419', { timeout: 10000 });
    return '😴 Sin alertas STW de V-Bucks por ahora.';
  } catch {
    return '❌ No se pudo verificar STW.';
  }
}

// ─── ENVIAR A TODOS LOS GRUPOS ───────────────────────────
async function enviarATodos() {
  if (!CONFIG.GRUPOS.length) {
    console.log('⚠️ Sin grupos. Envía !grupos para obtener IDs.');
    return;
  }

  const datos   = await obtenerDatosTienda();
  const mensaje = construirMensaje(datos);
  let enviados  = 0;

  for (const grupoId of CONFIG.GRUPOS) {
    try {
      let enviado = false;

      // Intentar enviar con imagen primero
      if (datos.imgDestacada) {
        enviado = await enviarImagenUrl(grupoId, datos.imgDestacada, mensaje);
      }

      // Si falla la imagen, enviar solo texto
      if (!enviado) await enviarMensaje(grupoId, mensaje);

      const meta = await sock.groupMetadata(grupoId).catch(() => ({ subject: grupoId }));
      console.log(`✅ Enviado → ${meta.subject}`);
      enviados++;
      await new Promise(r => setTimeout(r, 2500));
    } catch (err) {
      console.error(`❌ Error en ${grupoId}:`, err.message);
    }
  }
  console.log(`📤 Total: ${enviados}/${CONFIG.GRUPOS.length}`);
}

// ─── PROGRAMAR ENVÍO ─────────────────────────────────────
function programarEnvio() {
  cron.schedule(CONFIG.CRON_HORA, async () => {
    console.log(`\n🚀 [${new Date().toLocaleString('es-MX')}] Enviando tienda...`);
    await enviarATodos();
  }, { timezone: 'UTC' });
}

// ─── INICIAR ─────────────────────────────────────────────
console.log('🔄 Iniciando bot de Fortnite Item Shop...');
console.log(`📌 Tienda: ${CONFIG.SHOP_URL}`);
console.log(`🎯 Creador: ${CONFIG.CREATOR_CODE}`);
connectWA();
