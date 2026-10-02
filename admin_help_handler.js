// admin_help_handler.js
//
// Usage:
//   const registerAdminHelpCommand = require('./admin_help_handler');
//   registerAdminHelpCommand(bot, { db });
//
// Registers "/admin" (aliases: "/hc" and "/HiddenCommands") — shows the
// commands available to the CALLER'S OWN ROLE, pulled dynamically from
// commandRegistry.js and grouped by category (Admin, Account, Keys,
// [Outline], [WG], Servers, Other). Because it reads the registry instead
// of a copy-pasted string, it is always in sync with the handlers.
//
// ACCESS: any active admin (superadmin, admin, or moderator) — the
// command itself is inherently "what can I do", so all three tiers can
// run it, they just each see a different filtered list.
//
// Design notes:
//   - This file registers ITSELF into the registry too (see the
//     registry.register(...) call below), so /admin shows up in its own
//     output — consistent with every other command.
//   - Every other handler file needs ONE registry.register(...) call
//     added (at module top-level, not inside the bot-registration
//     function) for its command to appear here. See commandRegistry.js
//     for the exact call signature and how categories work.
//   - The list is split into several Telegram messages when it grows past
//     ~3500 characters (Telegram's hard limit is 4096); a category is
//     never cut in the middle unless it is longer than one message itself.
const registry = require('./commandRegistry');

registry.register(
    '/admin (aliases: /hc, /HiddenCommands)',
    'shows the commands available to your role, grouped by category',
    ['superadmin', 'admin', 'moderator'],
    'Admin'
);

// Usage:
//   escapeHtml('<username>') -> '&lt;username&gt;'
//
// Registered commands use plain "<placeholder>" syntax for readability
// (e.g. "/checkbalance <usd|rial> <count>"). Since this message is sent
// with parse_mode: 'HTML', those raw < > characters would otherwise be
// interpreted as actual (invalid) HTML tags and make the ENTIRE message
// fail to send with an ETELEGRAM error — escaping here means every
// registry.register() call can just use plain <placeholder> syntax
// without anyone needing to remember to hand-escape it.
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Usage:
//   buildAdminHelpMessages(registry.getAll(), 'admin')
//   // -> array of HTML strings, each safe to send as ONE Telegram message
// Groups the commands this role may run by category (in registry.CATEGORIES
// order, empty categories skipped) and packs the sections into messages.
function buildAdminHelpMessages(allCommands, role) {
    const MAX = 3500;
    const visible = allCommands.filter(c => c.roles.includes(role));
    if (visible.length === 0) return [];

    const sections = [];
    for (const cat of registry.CATEGORIES) {
        const items = visible
            .filter(c => c.category === cat.key)
            .sort((a, b) => a.usage.localeCompare(b.usage));
        if (items.length === 0) continue;

        let text = `<b>${escapeHtml(cat.title)}</b>\n`;
        for (const c of items) {
            text += `${escapeHtml(c.usage)}\n`;
            if (c.description) text += `   ${escapeHtml(c.description)}\n`;
        }
        sections.push(text);
    }

    const messages = [];
    let current = `👑 <b>Admin Commands</b> (your role: ${escapeHtml(role)})\n\n`;
    for (const section of sections) {
        if (current.length + section.length + 1 > MAX && current.trim().length > 0) {
            messages.push(current.trim());
            current = '';
        }
        current += section + '\n';
    }
    if (current.trim().length > 0) messages.push(current.trim());
    return messages;
}

module.exports = function registerAdminHelpCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/(admin|hc|HiddenCommands)$/i, async (msg) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;

        try {
            // --- any active admin (superadmin/admin/moderator) ---
            const [adminRows] = await db.execute(
                "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1",
                [senderId]
            );
            if (adminRows.length === 0) {
                await bot.sendMessage(chatId, '❌ Error: You are not an active admin.');
                return;
            }

            const role = adminRows[0].Role;
            const messages = buildAdminHelpMessages(registry.getAll(), role);

            if (messages.length === 0) {
                await bot.sendMessage(chatId, 'ℹ️ No commands available for your role.');
                return;
            }

            for (const part of messages) {
                await bot.sendMessage(chatId, part, { parse_mode: 'HTML' });
            }

        } catch (err) {
            console.error('/admin error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.message || err.code}`);
        }
    });
};
