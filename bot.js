/**
 * ╔══════════════════════════════════════════════════════╗
 * ║    BOT WHATSAPP — FORTNITE ITEM SHOP                 ║
 * ║    Railway Edition — Variables de entorno            ║
 * ╚══════════════════════════════════════════════════════╝
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron   = require('node-cron');
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

// ─── CONFIGURACIÓN DESDE VARIABLES DE ENTORNO ────────────
// Estas se configuran en Railway → Variables, nunca en el código
const CONFIG = {
  SHOP_URL:      process.env.SHOP_URL     || 'https://tbh002.infinityfree.me/item-shop.html?i=1',
  CREATOR_CODE:  process.env.CREATOR_CODE || 'Mr.TBH002',
  OWNER:         process.env.OWNER_NUMBER || '',          // Tu número: 527298635616
  CRON_HORA:     process.env.CRON_HORA    || '0 0 * * *', // Medianoche UTC = 6pm México
  FORTNITE_API:  'https://fortnite-api.com/v2/shop?language=es-419',
  IMG_PATH:      path.join('/tmp', 'shop_screenshot.jpg'),

  // IDs de grupos separados por coma en la variable de entorno GRUPOS
  // Ej: "1234567890-1234567890@g.us,0987654321-0987654321@g.us"
  get GRUPOS() {
    const g = process.env.GRUPOS || '';
    return g ? g.split(',').map(s => s.trim()).filter(Boolean) : [];
  }
};
// ─────────────────────────────────────────────────────────

// ─── CLIENTE WHATSAPP ────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/tmp/wa_session' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
    ],
  }
});

// QR en consola (visible en logs de Railway)
client.on('qr', qr => {
  console.log('\n');
  console.log('════════════════════════════════════════');
  console.log('  📱 ESCANEA ESTE QR CON WHATSAPP');
  console.log('════════════════════════════════════════');
  qrcode.generate(qr, { small: true });
  console.log('  WhatsApp → Dispositivos vinculados');
  console.log('════════════════════════════════════════\n');
});

client.on('ready', () => {
  console.log('✅ Bot conectado a WhatsApp!');
  console.log(`📋 Grupos configurados: ${CONFIG.GRUPOS.length}`);
  console.log(`⏰ Envío automático: ${CONFIG.CRON_HORA} UTC`);
  console.log('');
  console.log('Comandos disponibles (envíalos por WhatsApp):');
  console.log('  !grupos  → lista tus grupos con IDs');
  console.log('  !tienda  → envía la tienda ahora');
  console.log('  !test    → mensaje de prueba sin imagen');
  console.log('  !stw     → verifica alertas STW V-Bucks');
  programarEnvio();
});

client.on('auth_failure', msg => console.error('❌ Error de autenticación:', msg));
client.on('disconnected', r => {
  console.log('🔌 Desconectado:', r);
  // Intentar reconectar
  setTimeout(() => client.initialize(), 5000);
});

// ─── OBTENER DATOS DE LA TIENDA ──────────────────────────
async function obtenerDatosTienda() {
  try {
    const res    = await axios.get(CONFIG.FORTNITE_API, { timeout: 10000 });
    const data   = res.data.data;
    const fecha  = new Date(data.date);
    const fechaStr = fecha.toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const entries = data.entries ?? [];
    let total = 0, nuevos = 0, salePronto = 0, precioMin = Infinity;

    entries.forEach(e => {
      total++;
      if (e.banner?.backendValue === 'New') nuevos++;
      if (e.finalPrice) precioMin = Math.min(precioMin, e.finalPrice);
      if (e.outDate) {
        const h = (new Date(e.outDate) - Date.now()) / 3600000;
        if (h > 0 && h <= 24) salePronto++;
      }
    });

    const precioMinMXN = precioMin !== Infinity
      ? `$${((precioMin / 100) * 9.5).toFixed(0)} MXN`
      : 'desde $9.50 MXN';

    return { fechaStr, total, nuevos, salePronto, precioMinMXN };
  } catch (err) {
    console.error('Error obteniendo datos tienda:', err.message);
    return {
      fechaStr: new Date().toLocaleDateString('es-MX'),
      total: '?', nuevos: '?', salePronto: '?', precioMinMXN: 'desde $9.50 MXN'
    };
  }
}

// ─── VERIFICAR ALERTAS STW V-BUCKS ───────────────────────
async function verificarSTW() {
  try {
    // STW missions con V-Bucks
    const res = await axios.get('https://fortnite-api.com/v1/challenges?language=es-419', { timeout: 10000 });
    const misiones = res.data?.data ?? [];
    const vbucksMisiones = misiones.filter(m =>
      m.rewards?.some(r => r.itemType?.toLowerCase().includes('accountresource:currency_mtxswap'))
    );
    return vbucksMisiones.length > 0 ? vbucksMisiones : null;
  } catch {
    return null;
  }
}

// ─── CONSTRUIR MENSAJE TIENDA ─────────────────────────────
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

// ─── OBTENER IMAGEN DE LA TIENDA DESDE API ───────────────
async function obtenerImagenTienda() {
  try {
    // Intentar obtener imagen directamente de la API
    const res = await axios.get(CONFIG.FORTNITE_API, { timeout: 10000 });
    const entries = res.data?.data?.entries ?? [];

    // Buscar el item featured más destacado para usar su imagen
    const featured = entries.find(e => e.brItems?.[0]?.images?.featured);
    if (featured) {
      const imgUrl = featured.brItems[0].images.featured;
      const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 15000 });
      const b64 = Buffer.from(imgRes.data).toString('base64');
      return new MessageMedia('image/png', b64, 'tienda.png');
    }
  } catch (err) {
    console.error('Error obteniendo imagen:', err.message);
  }
  return null;
}

// ─── ENVIAR A TODOS LOS GRUPOS ───────────────────────────
async function enviarATodos() {
  if (CONFIG.GRUPOS.length === 0) {
    console.log('⚠️  Sin grupos configurados. Envía !grupos por WhatsApp para ver IDs.');
    return;
  }

  console.log('📊 Obteniendo datos de la tienda...');
  const datos   = await obtenerDatosTienda();
  const mensaje = construirMensaje(datos);
  const media   = await obtenerImagenTienda();

  let enviados = 0;
  for (const grupoId of CONFIG.GRUPOS) {
    try {
      const chat = await client.getChatById(grupoId);
      if (media) {
        await chat.sendMessage(media, { caption: mensaje });
      } else {
        await chat.sendMessage(mensaje);
      }
      console.log(`✅ Enviado → ${chat.name}`);
      enviados++;
      await new Promise(r => setTimeout(r, 2500)); // pausa entre grupos
    } catch (err) {
      console.error(`❌ Error en grupo ${grupoId}:`, err.message);
    }
  }
  console.log(`📤 Total enviados: ${enviados}/${CONFIG.GRUPOS.length}`);
}

// ─── PROGRAMAR ENVÍO AUTOMÁTICO ──────────────────────────
function programarEnvio() {
  cron.schedule(CONFIG.CRON_HORA, async () => {
    console.log(`\n🚀 [${new Date().toLocaleString('es-MX')}] Enviando tienda del día...`);
    await enviarATodos();
  }, { timezone: 'UTC' });
  console.log(`⏰ Cron programado: ${CONFIG.CRON_HORA} UTC`);
}

// ─── COMANDOS POR WHATSAPP ───────────────────────────────
client.on('message', async msg => {
  // Solo responder al dueño
  const ownerNum = CONFIG.OWNER.replace(/\D/g, '');
  if (!msg.from.includes(ownerNum)) return;

  switch (msg.body.toLowerCase().trim()) {

    case '!grupos': {
      const chats  = await client.getChats();
      const grupos = chats.filter(c => c.isGroup);
      if (!grupos.length) { msg.reply('No estás en ningún grupo.'); return; }
      let lista = `📋 *Tus grupos (${grupos.length}):*\n\n`;
      grupos.forEach((g, i) => {
        lista += `${i + 1}. *${g.name}*\n\`${g.id._serialized}\`\n\n`;
      });
      lista += '➡️ Copia el ID y agrégalo en Railway → Variables → GRUPOS\n';
      lista += 'Separa varios IDs con coma.';
      msg.reply(lista);
      break;
    }

    case '!tienda': {
      msg.reply('📸 Generando y enviando tienda a todos los grupos...');
      await enviarATodos();
      msg.reply('✅ ¡Listo! Tienda enviada.');
      break;
    }

    case '!test': {
      const datos = await obtenerDatosTienda();
      msg.reply(construirMensaje(datos));
      break;
    }

    case '!stw': {
      msg.reply('🔍 Verificando misiones STW con V-Bucks...');
      const misiones = await verificarSTW();
      if (misiones) {
        let txt = `⚡ *ALERTA STW — V-Bucks disponibles!*\n\n`;
        misiones.slice(0, 5).forEach(m => {
          const vb = m.rewards?.find(r => r.itemType?.includes('currency'))?.quantity ?? '?';
          txt += `• ${m.name ?? 'Misión'} → *${vb} V-Bucks*\n`;
        });
        msg.reply(txt);
      } else {
        msg.reply('😴 Sin misiones STW con V-Bucks disponibles ahorita.');
      }
      break;
    }

    case '!ayuda': {
      msg.reply(`🤖 *Comandos disponibles:*

!grupos  → Lista tus grupos con IDs
!tienda  → Envía la tienda ahora
!test    → Mensaje de prueba
!stw     → Alertas V-Bucks STW
!ayuda   → Este menú`);
      break;
    }
  }
});

// ─── INICIAR BOT ─────────────────────────────────────────
console.log('🔄 Iniciando bot de Fortnite Item Shop...');
console.log(`📌 Tienda: ${CONFIG.SHOP_URL}`);
console.log(`🎯 Creador: ${CONFIG.CREATOR_CODE}`);
client.initialize();
