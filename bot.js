/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       BOT WHATSAPP — FORTNITE ITEM SHOP              ║
 * ║       Envía imagen + mensaje a grupos al día          ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * INSTALACIÓN:
 *   npm install whatsapp-web.js qrcode-terminal puppeteer node-cron axios
 *
 * USO:
 *   node bot.js
 *   (Escanea el QR con tu WhatsApp la primera vez)
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode    = require('qrcode-terminal');
const cron      = require('node-cron');
const puppeteer = require('puppeteer');
const axios     = require('axios');
const fs        = require('fs');
const path      = require('path');

// ─── CONFIGURACIÓN ───────────────────────────────────────
const CONFIG = {
  // URL de tu página desplegada
  SHOP_URL: 'https://tbh002.infinityfree.me/item-shop.html?i=1',

  // Código de creador
  CREATOR_CODE: 'Mr.TBH002',

  // IDs de los grupos donde enviar (se llenan automáticamente al usar !grupos)
  // Formato: 'XXXXXXXXXX-XXXXXXXXXX@g.us'
  GRUPOS: [
    // Agrega aquí los IDs de tus grupos (usa el comando !grupos para verlos)
  ],

  // Hora de envío automático (6pm hora México = 18:00 UTC-6 = 00:00 UTC)
  // Cron: minuto hora día mes díaSemana
  CRON_HORA: '0 0 * * *',   // medianoche UTC = 6pm México

  // Ruta donde guardar la captura
  IMG_PATH: path.join(__dirname, 'shop_screenshot.jpg'),

  // API de Fortnite para verificar V-Bucks STW
  FORTNITE_API: 'https://fortnite-api.com/v2/shop?language=es-419',
};
// ─────────────────────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './wa_session' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }
});

// Mostrar QR para escanear
client.on('qr', qr => {
  console.log('\n📱 Escanea este QR con tu WhatsApp:\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Bot conectado a WhatsApp!');
  console.log('📋 Comandos disponibles en chat:');
  console.log('   !grupos     — lista tus grupos');
  console.log('   !tienda     — envía la tienda ahora');
  console.log('   !test       — envía mensaje de prueba');
  programarEnvio();
});

client.on('auth_failure', () => console.error('❌ Error de autenticación'));
client.on('disconnected', r => console.log('🔌 Desconectado:', r));

// ─── CAPTURA DE PANTALLA DE LA TIENDA ────────────────────
async function capturarTienda() {
  console.log('📸 Capturando tienda...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Resolución de escritorio para captura completa
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1.5 });
  await page.goto(CONFIG.SHOP_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  // Esperar a que cargue la tienda
  await page.waitForSelector('.item-card', { timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000)); // extra para imágenes

  // Capturar solo el contenido principal (sin modal)
  await page.screenshot({
    path: CONFIG.IMG_PATH,
    type: 'jpeg',
    quality: 85,
    fullPage: true,
  });

  await browser.close();
  console.log('✅ Captura guardada:', CONFIG.IMG_PATH);
  return CONFIG.IMG_PATH;
}

// ─── OBTENER DATOS DE LA TIENDA ──────────────────────────
async function obtenerDatosTienda() {
  try {
    const res  = await axios.get(CONFIG.FORTNITE_API);
    const data = res.data.data;
    const fecha = new Date(data.date);
    const fechaStr = fecha.toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const entries = data.entries ?? [];
    let total = 0, nuevos = 0, saleProno = 0;

    entries.forEach(e => {
      const items = e.brItems ?? [];
      total += items.length || 1;
      if (e.banner?.backendValue === 'New') nuevos++;
      if (e.outDate) {
        const h = (new Date(e.outDate) - Date.now()) / 3600000;
        if (h > 0 && h <= 24) saleProno++;
      }
    });

    return { fechaStr, total, nuevos, saleProno };
  } catch (err) {
    console.error('Error obteniendo datos:', err.message);
    return { fechaStr: new Date().toLocaleDateString('es-MX'), total: '?', nuevos: '?', saleProno: '?' };
  }
}

// ─── CONSTRUIR MENSAJE ───────────────────────────────────
function construirMensaje({ fechaStr, total, nuevos, saleProno }) {
  return `🎮 *FORTNITE ITEM SHOP*
📅 ${fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1)}

🛒 *${total}* items disponibles hoy
🟢 *${nuevos}* nuevas ofertas
🔴 *${saleProno}* se van pronto

💰 *Precios bajos en compras con V-Bucks*
¡No te quedes sin tu skin favorita!

⭐ *Apoya a tu creador de contenido*
🎯 Código de Creador: *${CONFIG.CREATOR_CODE}*

🌐 Ver tienda completa con precios en MXN:
${CONFIG.SHOP_URL}

_Úsalo antes de comprar en Fortnite_ 🙌`;
}

// ─── ENVIAR A GRUPOS ─────────────────────────────────────
async function enviarATodos() {
  if (CONFIG.GRUPOS.length === 0) {
    console.log('⚠️  No hay grupos configurados. Usa !grupos para ver IDs.');
    return;
  }

  const datos = await obtenerDatosTienda();
  const mensaje = construirMensaje(datos);
  let imgPath;

  try {
    imgPath = await capturarTienda();
  } catch (err) {
    console.error('Error capturando tienda:', err.message);
  }

  for (const grupoId of CONFIG.GRUPOS) {
    try {
      const chat = await client.getChatById(grupoId);

      if (imgPath && fs.existsSync(imgPath)) {
        const media = MessageMedia.fromFilePath(imgPath);
        await chat.sendMessage(media, { caption: mensaje });
      } else {
        await chat.sendMessage(mensaje);
      }

      console.log(`✅ Enviado a: ${chat.name}`);
      // Pausa entre grupos para no parecer spam
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`❌ Error enviando a ${grupoId}:`, err.message);
    }
  }
}

// ─── PROGRAMAR ENVÍO AUTOMÁTICO ──────────────────────────
function programarEnvio() {
  console.log(`⏰ Envío automático programado: ${CONFIG.CRON_HORA} UTC (6pm México)`);
  cron.schedule(CONFIG.CRON_HORA, async () => {
    console.log('🚀 Enviando tienda del día...');
    await enviarATodos();
  }, { timezone: 'UTC' });
}

// ─── COMANDOS POR CHAT ───────────────────────────────────
client.on('message', async msg => {
  // Solo responder a mensajes del dueño (tu número)
  const OWNER = '527298635616@c.us';
  if (msg.from !== OWNER && !msg.from.includes(OWNER.split('@')[0])) return;

  if (msg.body === '!grupos') {
    const chats = await client.getChats();
    const grupos = chats.filter(c => c.isGroup);
    if (grupos.length === 0) {
      msg.reply('No estás en ningún grupo.');
      return;
    }
    let lista = '📋 *Tus grupos:*\n\n';
    grupos.forEach((g, i) => {
      lista += `${i + 1}. *${g.name}*\n   ID: \`${g.id._serialized}\`\n\n`;
    });
    lista += '➡️ Copia el ID y pégalo en CONFIG.GRUPOS en bot.js';
    msg.reply(lista);
  }

  if (msg.body === '!tienda') {
    msg.reply('📸 Generando y enviando tienda...');
    await enviarATodos();
    msg.reply('✅ Tienda enviada a todos los grupos!');
  }

  if (msg.body === '!test') {
    const datos = await obtenerDatosTienda();
    msg.reply(construirMensaje(datos));
  }
});

// ─── INICIAR ─────────────────────────────────────────────
console.log('🔄 Iniciando bot...');
client.initialize();
