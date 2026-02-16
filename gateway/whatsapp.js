import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeInMemoryStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { config } from '../config/index.js';
import { markConnected } from '../safety/monitor.js';

let sock = null;
let messageHandler = null;
const store = makeInMemoryStore({});

// Format number for WhatsApp JID
function formatJid(number) {
  // Strip any non-numeric characters
  const clean = number.replace(/\D/g, '');
  return `${clean}@s.whatsapp.net`;
}

const targetJid = formatJid(config.whatsapp.targetNumber);

// ââ Public API ââââââââââââââââââââââââââââââââââââââ

export function onMessage(handler) {
  messageHandler = handler;
}

export async function sendMessage(text, promptDayNumber = null) {
  if (!sock) {
    throw new Error('WhatsApp not connected');
  }

  try {
    await sock.sendMessage(targetJid, { text });
    console.log(`[WhatsApp] Sent${promptDayNumber ? ` (Day ${promptDayNumber})` : ''}: "${text.substring(0, 60)}..."`);
  } catch (err) {
    console.error('[WhatsApp] Failed to send:', err.message);
    throw err;
  }
}

export async function startGateway() {
  const { state, saveCreds } = await useMultiFileAuthState(config.paths.authPath);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['Presence', 'Chrome', '22.0'],
    // Reduce logging noise
    logger: {
      level: 'silent',
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: console.warn,
      error: console.error,
      fatal: console.error,
      child: () => ({
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error,
        fatal: console.error,
        child: () => this,
      }),
    },
  });

  store.bind(sock.ev);

  // ââ Connection events âââââââââââââââââââââââââââ

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n[WhatsApp] Scan this QR code with your SECONDARY WhatsApp number:');
      // qrcode-terminal handles display via printQRInTerminal option
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[WhatsApp] Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        // Reconnect with exponential backoff
        setTimeout(() => {
          console.log('[WhatsApp] Attempting reconnection...');
          startGateway();
        }, 5000);
      } else {
        console.error('[WhatsApp] Logged out. Delete the auth folder and re-scan QR code.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      console.log('[WhatsApp] Connected.');
      markConnected();
    }
  });

  // ââ Credential updates ââââââââââââââââââââââââââ

  sock.ev.on('creds.update', saveCreds);

  // ââ Incoming messages âââââââââââââââââââââââââââ

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Only process messages from the target number
      if (msg.key.remoteJid !== targetJid) continue;

      // Ignore outgoing messages
      if (msg.key.fromMe) continue;

      // Extract text content
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        null;

      if (!text) {
        console.log('[WhatsApp] Received non-text message. Ignoring.');
        continue;
      }

      console.log(`[WhatsApp] Received: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

      if (messageHandler) {
        try {
          await messageHandler(text);
        } catch (err) {
          console.error('[WhatsApp] Error handling message:', err);
        }
      }
    }
  });
}
