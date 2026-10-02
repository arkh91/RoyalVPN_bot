// availableserversoutline_handler.js
//
// Usage:
//   const registerAvailableServersCommand = require('./availableserversoutline_handler');
//   registerAvailableServersCommand(bot, { SERVERS, db });
//
// Registers "/availableserversoutline" and its alias "/aso" — lists every
// Outline server configured in servers.js (name + aliases/hostnames),
// mainly as a quick reference for which ServerName to pass to commands
// like /testserver, /servercheck, /removekey, etc.
//
// ACCESS: any active admin (superadmin, admin, or moderator).
//
// Design notes:
//   - This is a STATIC config listing, not a live reachability check —
//     it reads straight from the SERVERS object in servers.js and does
//     NOT call each server's API to confirm it's actually up. A server
//     appearing here means it's configured, not necessarily reachable
//     (that's what /servercheck's per-key API calls would surface).
const registry = require('./commandRegistry');
registry.register('/availableserversoutline or /aso', 'list all configured Outline servers', ['superadmin', 'admin', 'moderator']);

module.exports = function registerAvailableServersCommand(bot, deps) {
    const { db, SERVERS } = deps;

    bot.onText(/^\/(availableserversoutline|aso)$/i, async (msg) => {
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

            const serverNames = Object.keys(SERVERS).sort();
            if (serverNames.length === 0) {
                await bot.sendMessage(chatId, 'ℹ️ No servers configured.');
                return;
            }

            let message = `🌐 Available Outline Servers (${serverNames.length}):\n\n`;
            serverNames.forEach((name, i) => {
                const config = SERVERS[name];
                const aliases = (config.aliases && config.aliases.filter(Boolean).length > 0)
                    ? config.aliases.filter(Boolean).join(', ')
                    : '(no aliases set)';
                message += `${i + 1}. ${name}\n   ${aliases}\n\n`;
            });

            await bot.sendMessage(chatId, message.trim());

        } catch (err) {
            console.error('/availableserversoutline error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.message || err.code}`);
        }
    });
};
