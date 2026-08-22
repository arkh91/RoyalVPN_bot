// usagewarninginfo_handler.js
//
// Usage:
//   const registerUsageWarningInfoCommand = require('./usagewarninginfo_handler');
//   registerUsageWarningInfoCommand(bot, { db, SERVERS, axios, https });
//
// Registers "/usagewarninginfo [min] [max]" — a VIEW-ONLY counterpart to
// /UsageWarning. Scans every key across every server and reports back to
// the admin which keys fall within the given usage percentage range, but
// (unlike /UsageWarning) never sends anything to the key owners
// themselves. Purely for the admin's own reference.
//
// ACCESS: superadmin + admin (moderator excluded) — same gate as
// /UsageWarning and /servercheck.
//
// Usage examples:
//   /usagewarninginfo          -> shows usage instructions, runs no scan
//   /usagewarninginfo 20       -> lists every key at or above 20% usage
//   /usagewarninginfo 20 70    -> lists every key between 20% and 70% usage
//
// Report sent back to the admin, per qualifying key:
//   #GuiKey
//   Usage/Limit
//   UserID 123456789 @username  (or "No Username")
//
// Design notes:
//   - No notifications are ever sent to key owners here — this command
//     only ever talks to the admin who ran it. /UsageWarning is the
//     command that actually messages users; this one is read-only.
//   - Same "all available keys, no age cutoff" scope as /UsageWarning,
//     and the same skip rules: keys with no configured DataLimit can't
//     have a percentage computed (skipped), and keys no longer present
//     on their server (Expired) are skipped since there's no usage to
//     evaluate.
const { getKeysUsage, formatBytes } = require('./getKeysUsage');

// Usage:
//   await sendInChunks(bot, chatId, longText)
//
// Splits a long report into multiple messages so it doesn't get rejected
// by Telegram's ~4096 char message limit when many keys qualify.
async function sendInChunks(bot, chatId, text) {
    const CHUNK_SIZE = 3500;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        await bot.sendMessage(chatId, text.slice(i, i + CHUNK_SIZE));
    }
}

module.exports = function registerUsageWarningInfoCommand(bot, deps) {
    const { db, SERVERS, axios, https } = deps;

    bot.onText(/^\/usagewarninginfo(?:\s+(\d+))?(?:\s+(\d+))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;

        try {
            // --- superadmin / admin gate (moderator excluded) ---
            const [senderRows] = await db.execute(
                "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1",
                [senderId]
            );
            if (senderRows.length === 0 || !['superadmin', 'admin'].includes(senderRows[0].Role)) {
                await bot.sendMessage(chatId, '❌ Error: This command is restricted to superadmins and admins.');
                return;
            }

            // --- No arguments: show usage instructions, don't scan ---
            if (match[1] === undefined) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ Usage:\n" +
                    "/usagewarninginfo <min>          - keys at or above <min>% usage\n" +
                    "/usagewarninginfo <min> <max>    - keys between <min>% and <max>% usage\n\n" +
                    "Example: /usagewarninginfo 20\n" +
                    "Example: /usagewarninginfo 20 70"
                );
                return;
            }

            // --- Parse min (required once any arg is given) and optional max ---
            const minPercent = parseInt(match[1], 10);
            if (isNaN(minPercent) || minPercent < 0 || minPercent > 100) {
                await bot.sendMessage(chatId, '⚠️ <min> must be a number between 0 and 100.');
                return;
            }

            let maxPercent = null;
            if (match[2] !== undefined) {
                maxPercent = parseInt(match[2], 10);
                if (isNaN(maxPercent) || maxPercent < 0 || maxPercent > 100) {
                    await bot.sendMessage(chatId, '⚠️ <max> must be a number between 0 and 100.');
                    return;
                }
                if (maxPercent < minPercent) {
                    await bot.sendMessage(chatId, '⚠️ <max> cannot be smaller than <min>.');
                    return;
                }
            }

            const minThreshold = minPercent / 100;
            const maxThreshold = maxPercent === null ? null : maxPercent / 100;
            const rangeLabel = maxPercent === null ? `>= ${minPercent}%` : `${minPercent}%-${maxPercent}%`;

            const serverNames = Object.keys(SERVERS);
            if (serverNames.length === 0) {
                await bot.sendMessage(chatId, 'ℹ️ No servers configured.');
                return;
            }

            await bot.sendMessage(
                chatId,
                `🔎 Scanning ${serverNames.length} server(s) for keys ${rangeLabel} usage...`
            );

            const reportLines = [];
            let scannedKeys = 0;
            let flaggedKeys = 0;

            for (const serverName of serverNames) {
                const [rows] = await db.execute(
                    `SELECT uk.UserID, uk.GuiKey, a.Username
                     FROM UserKeys uk
                     LEFT JOIN accounts a ON uk.UserID = a.UserID
                     WHERE uk.ServerName = ?`,
                    [serverName]
                );

                if (rows.length === 0) continue;

                let usageMap;
                try {
                    usageMap = await getKeysUsage(serverName, SERVERS, axios, https);
                } catch (err) {
                    console.error(`UsageWarningInfo: usage fetch failed for ${serverName}:`, err.message);
                    reportLines.push(`${serverName}: ⚠️ Failed to reach server API: ${err.message}`);
                    continue;
                }

                for (const row of rows) {
                    scannedKeys++;
                    const guiKey = (row.GuiKey || '').trim();
                    if (!guiKey) continue;

                    const info = usageMap.get(guiKey);
                    // No info -> key no longer on server (Expired) -> skip.
                    // No limitBytes -> "no limit" key, can't compute a percentage -> skip.
                    if (!info || !info.limitBytes) continue;

                    const percent = info.bytes / info.limitBytes;
                    if (percent < minThreshold) continue;
                    if (maxThreshold !== null && percent > maxThreshold) continue;

                    flaggedKeys++;
                    const usageText = `${formatBytes(info.bytes)}/${formatBytes(info.limitBytes)}`;
                    const nameForReport = row.Username ? `@${row.Username}` : 'No Username';

                    reportLines.push(`${guiKey}\n${usageText}\nUserID ${row.UserID} ${nameForReport}`);
                }
            }

            if (reportLines.length === 0) {
                await bot.sendMessage(
                    chatId,
                    `✅ Scan complete. ${scannedKeys} key(s) checked, none ${rangeLabel}.`
                );
                return;
            }

            const report =
                `📋 Usage info scan complete (${rangeLabel}).\n` +
                `Checked: ${scannedKeys} key(s) | Flagged: ${flaggedKeys}\n\n` +
                reportLines.join('\n\n');

            await sendInChunks(bot, chatId, report);

        } catch (err) {
            console.error('/usagewarninginfo error:', err);
            await bot.sendMessage(chatId, '⚠️ Internal error occurred during usage info scan.');
        }
    });
};
