// ks_handler.js
//
// Usage:
//   const registerKsCommand = require('./ks_handler');
//   registerKsCommand(bot, { db, KeyExists, SERVERS, axios, https });
//
// Registers the /ks command (lists a user's own keys + usage) onto the
// given bot instance. Kept in its own file so commands.js doesn't grow
// even longer, but it needs the same deps object commands.js already has.
const { getKeysUsage, formatBytes } = require('./getKeysUsage');

module.exports = function registerKsCommand(bot, deps) {
    const { db, KeyExists, SERVERS, axios, https } = deps;

    bot.onText(/\/ks/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        try {
            const [rows] = await db.execute(
                `SELECT FullKey, GuiKey, ServerName, IssuedAt
                 FROM UserKeys
                 WHERE UserID = ?
                   AND IssuedAt >= NOW() - INTERVAL 45 DAY
                 ORDER BY IssuedAt DESC`,
                [userId]
            );

            if (rows.length === 0) {
                return bot.sendMessage(chatId, "❌ No keys found in the last 45 days.");
            }

            const escapeHTML = (text) =>
                text.replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");

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

            let message = `🔑 Keys for UserID: <code>${escapeHTML(String(userId))}</code> — ${rows.length} total:\n\n`;
            let messages = [];
            let count = 1;

            for (const row of rows) {
                const { FullKey, GuiKey, ServerName, IssuedAt } = row;
                const exists = await KeyExists(ServerName, GuiKey);
                const statusText = exists ? "<b>Active</b>" : "<b>Not Active</b>";
                const issued = new Date(IssuedAt).toDateString().slice(0, 10);

                const usageMap = await getUsageMapCached(ServerName);
                const info = usageMap.get(GuiKey.trim());
                const usageText = info
                    ? (info.limitBytes
                        ? `${formatBytes(info.bytes)} / ${formatBytes(info.limitBytes)}`
                        : `${formatBytes(info.bytes)} (no limit)`)
                    : "N/A";

                const entry =
                    `${count}. FullKey: <code>${escapeHTML(FullKey)}</code>\n` +
                    `   IssuedAt: ${escapeHTML(issued)}\n` +
                    `   Status: ${statusText}\n` +
                    `   Usage: ${escapeHTML(usageText)}\n\n`;

                if (message.length + entry.length > 4000) {
                    messages.push(message);
                    message = "";
                }
                message += entry;
                count++;
            }

            if (message.length > 0) messages.push(message);

            for (const part of messages) {
                await bot.sendMessage(chatId, part, { parse_mode: "HTML" });
            }
        } catch (err) {
            console.error("Error fetching keys:", err);
            await bot.sendMessage(chatId, "⚠️ Error fetching your keys. Please try again later.");
        }
    });
};
