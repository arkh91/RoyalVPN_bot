// lastkeys_handler.js
//
// Usage:
//   const registerLastKeysCommand = require('./lastkeys_handler');
//   registerLastKeysCommand(bot, { db, SERVERS, axios, https });
//
// Registers "/lastkeys" and its alias "/lk" — shows the last N keys
// issued across ALL users/servers (most recent first), with FullKey,
// UserID (tap-to-copy), Username (if available), and Usage/Limit or
// Expired. Same argument/help pattern as /listusers (/lu).
//
// ACCESS: superadmin + admin only (moderator excluded), same gate as
// /listusers and /servercheck.
//
// Usage:
//   /lastkeys          -> shows usage instructions, lists nothing
//   /lk                -> same, alias
//   /lastkeys 10       -> lists the last 10 keys issued
//   /lk 10             -> same, alias
//
// Design notes:
//   - Tap-to-copy is achieved via HTML <code> tags + parse_mode: 'HTML',
//     same technique already used for UserID in /listusers and
//     /UsageWarning.
//   - <count> is interpolated directly into LIMIT (after validating it's
//     a positive integer via parseInt) rather than bound as a parameter,
//     matching the codebase's existing convention (older mysql2 driver
//     versions error on "LIMIT ?" in prepared statements).
//   - Usage is looked up per-server with the same getKeysUsage() caching
//     pattern used in /ks, /keyusername, /keyuserid — one API round-trip
//     PER SERVER represented in the result set, not per key, even though
//     these last N keys can span several different servers.
//   - A key shows "Expired" if it's no longer present on its server,
//     same convention as every other status command in this bot.
const { getKeysUsage, formatBytes } = require('./getKeysUsage');
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const registry = require('./commandRegistry');
registry.register('/lastkeys or /lk <count>', 'last N keys issued, with usage', ['superadmin', 'admin']);

module.exports = function registerLastKeysCommand(bot, deps) {
    const { db, SERVERS, axios, https } = deps;

    bot.onText(/^\/(lastkeys|lk)(?:\s+(\d+))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;

        try {
            // --- superadmin / admin gate (moderator excluded) ---
            const [adminRows] = await db.execute(
                "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1",
                [senderId]
            );
            if (adminRows.length === 0 || !['superadmin', 'admin'].includes(adminRows[0].Role)) {
                await bot.sendMessage(chatId, '❌ Error: This command is restricted to superadmins and admins.');
                return;
            }

            // --- No argument: show usage instructions, list nothing ---
            if (match[2] === undefined) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ Usage:\n" +
                    "/lastkeys <count>   - list the last <count> keys issued\n" +
                    "/lk <count>         - same, alias\n\n" +
                    "Example: /lk 10"
                );
                return;
            }

            const count = parseInt(match[2], 10);
            if (isNaN(count) || count <= 0) {
                await bot.sendMessage(chatId, '⚠️ <count> must be a positive number.');
                return;
            }

            const [keys] = await db.execute(
                `SELECT uk.FullKey, uk.GuiKey, uk.ServerName, uk.UserID, uk.IssuedAt, a.Username
                 FROM UserKeys uk
                 LEFT JOIN accounts a ON uk.UserID = a.UserID
                 ORDER BY uk.IssuedAt DESC
                 LIMIT ${count}`
            );

            if (keys.length === 0) {
                await bot.sendMessage(chatId, 'ℹ️ No keys found.');
                return;
            }

            // Usage cache: one getKeysUsage() round-trip PER SERVER
            // represented in this result set, not per key.
            const usageCache = {};
            const getUsageMapCached = async (serverName) => {
                if (!usageCache[serverName]) {
                    try {
                        usageCache[serverName] = await getKeysUsage(serverName, SERVERS, axios, https);
                    } catch (err) {
                        console.error(`Usage fetch failed for ${serverName}:`, err.message);
                        usageCache[serverName] = new Map();
                    }
                }
                return usageCache[serverName];
            };

            let messages = [];
            let response = `🔑 Last ${keys.length} key(s) issued:\n\n`;

            for (const [i, key] of keys.entries()) {
                const { FullKey, GuiKey, ServerName, UserID, Username } = key;

                const usageMap = await getUsageMapCached(ServerName);
                const info = usageMap.get((GuiKey || '').trim());
                const usageText = info
                    ? (info.limitBytes
                        ? `${formatBytes(info.bytes)}/${formatBytes(info.limitBytes)}`
                        : `${formatBytes(info.bytes)} (no limit)`)
                    : 'Expired';

                const usernamePart = Username ? `@${escapeHtml(Username)}` : 'No Username';

                const entry =
                    `${i + 1}. FullKey: <code>${escapeHtml(FullKey)}</code>\n` +
                    `   UserID: <code>${UserID}</code>\n` +
                    `   ${usernamePart}\n` +
                    `   Usage: ${escapeHtml(usageText)}\n\n`;

                if (response.length + entry.length > 3500) {
                    messages.push(response);
                    response = "";
                }
                response += entry;
            }

            if (response.length > 0) messages.push(response);

            for (const part of messages) {
                await bot.sendMessage(chatId, part, { parse_mode: 'HTML' });
            }

        } catch (err) {
            console.error('/lastkeys error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.code || err.message}`);
        }
    });
};
