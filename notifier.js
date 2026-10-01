'use strict';

// ── Telegram notifier ────────────────────────────────────────────────────
// Sends messages via the Telegram Bot API.
// A WhatsApp sender can be added later as another exported function with
// the same signature: (text) => Promise<void>. index.js only calls the
// notifier selected by NOTIFIER_PROVIDER (default "telegram").

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Send a plain-text message to the configured Telegram chat.
 * @param {string} text - message body (supports Telegram HTML parse mode)
 * @returns {Promise<void>}
 * @throws {Error} if TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are missing or the API rejects the message
 */
async function sendTelegram(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (see SETUP.md)');
    }

    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: false,   // keep the watch-link preview visible
        })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(`Telegram API error ${res.status}: ${data.description || 'unknown'}`);
    }
}

// Registry: provider name → sender function. Add "whatsapp" here later.
const providers = {
    telegram: sendTelegram,
};

function getNotifier() {
    const name = (process.env.NOTIFIER_PROVIDER || 'telegram').toLowerCase();
    const sender = providers[name];
    if (!sender) {
        throw new Error(`Unknown NOTIFIER_PROVIDER "${name}". Available: ${Object.keys(providers).join(', ')}`);
    }
    return sender;
}

module.exports = { getNotifier, providers };
