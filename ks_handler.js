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

// Usage:
//   isWgClientActive(wgRow) -> true/false
//
// A wg_clients row is active when none of its own lifecycle flags say
// otherwise — no live server call needed, unlike the Outline branch
// below (KeyExists()). Duplicated locally rather than imported, same as
// keystatus_handler.js and commands.js, so this file has no hidden
// cross-file dependency.
function isWgClientActive(client) {
    return !!client.is_active && !client.is_expired && !client.is_suspended && !client.is_deleted;
}

// Usage:
//   formatWgUsageLine(wgRow) // -> "1.2 GB / 50 GB", "3 MB (no limit)", "Expired (1.2 GB)"
//
// Straight from the row's own total_bytes/max_data_limit columns — this
// is the "usage displayed based on the database table" behavior for
// WireGuard, same as elsewhere: no getKeysUsage() round-trip, since
// WireGuard usage is already tracked in the DB.
function formatWgUsageLine(client) {
    const usedBytes = client.total_bytes != null
        ? Number(client.total_bytes)
        : Number(client.rx_bytes || 0) + Number(client.tx_bytes || 0);
    const used = formatBytes(usedBytes);

    if (client.is_deleted) return `Deleted (${used})`;
    if (client.is_expired) return `Expired (${used})`;
    if (client.is_suspended) return `Suspended (${used})`;
    if (!client.is_active) return `Inactive (${used})`;

    return client.max_data_limit
        ? `${used} / ${formatBytes(Number(client.max_data_limit))}`
        : `${used} (no limit)`;
}

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

            // Same 45-day window, same UserID, the WireGuard table instead.
            // is_deleted = 1 rows are excluded outright (soft-deleted, not
            // just expired/suspended).
            const [wgRows] = await db.execute(
                `SELECT name, server_name, is_active, is_expired, is_suspended, is_deleted,
                        created_at, total_bytes, rx_bytes, tx_bytes, max_data_limit
                 FROM wg_clients
                 WHERE UserID = ?
                   AND is_deleted = 0
                   AND created_at >= NOW() - INTERVAL 45 DAY
                 ORDER BY created_at DESC`,
                [userId]
            );

            if (rows.length === 0 && wgRows.length === 0) {
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

            let message = `🔑 Keys for UserID: <code>${escapeHTML(String(userId))}</code>\n\n`;
            let messages = [];

            // Appends one entry, splitting into a new Telegram message
            // whenever the running message would cross Telegram's text
            // limit (kept at 4000 for margin, same threshold as before).
            const appendChunk = (entry) => {
                if (message.length + entry.length > 4000) {
                    messages.push(message);
                    message = "";
                }
                message += entry;
            };

            // --- Outline section (unchanged behavior/logic) ---
            appendChunk(`🅾️ <b>Outline Keys</b> — ${rows.length} total:\n\n`);
            if (rows.length === 0) {
                appendChunk(`ℹ️ No Outline keys.\n\n`);
            } else {
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

                    appendChunk(
                        `${count}. FullKey: <code>${escapeHTML(FullKey)}</code>\n` +
                        `   IssuedAt: ${escapeHTML(issued)}\n` +
                        `   Status: ${statusText}\n` +
                        `   Usage: ${escapeHTML(usageText)}\n\n`
                    );
                    count++;
                }
            }

            // --- WireGuard section — each entry carries an explicit
            // "🔌 [WG]" tag so it's unmistakable which protocol a key
            // belongs to even if this section lands in its own chunk. ---
            appendChunk(`🔌 <b>WireGuard Keys</b> — ${wgRows.length} total:\n\n`);
            if (wgRows.length === 0) {
                appendChunk(`ℹ️ No WireGuard keys.\n\n`);
            } else {
                wgRows.forEach((client, i) => {
                    const issued = new Date(client.created_at).toDateString().slice(0, 10);
                    const statusText = isWgClientActive(client) ? "<b>Active</b>" : "<b>Not Active</b>";

                    appendChunk(
                        `${i + 1}. 🔌 <b>[WG]</b> Name: <code>${escapeHTML(client.name)}</code>\n` +
                        `   Server: ${escapeHTML(client.server_name)}\n` +
                        `   IssuedAt: ${escapeHTML(issued)}\n` +
                        `   Status: ${statusText}\n` +
                        `   Usage: ${escapeHTML(formatWgUsageLine(client))}\n\n`
                    );
                });
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
