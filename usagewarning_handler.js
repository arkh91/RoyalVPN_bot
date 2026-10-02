// usagewarning_handler.js
//
// Usage:
//   const registerUsageWarningCommand = require('./usagewarning_handler');
//   registerUsageWarningCommand(bot, { db, SERVERS, axios, https });
//
// Registers "/UsageWarning [min] [max]" — scans every key across every
// server and, for any key whose usage falls in the given percentage
// range, sends that key's owner a warning message. Reports back to the
// admin who ran it with ONE SEPARATE MESSAGE PER FLAGGED KEY (not one
// combined report), so each key's result is its own message.
//
// ACCESS: superadmin + admin (moderator excluded) — same gate as
// /servercheck and /usagewarninginfo.
//
// Usage examples:
//   /UsageWarning          -> shows usage instructions, runs no scan
//   /UsageWarning 20       -> warns every key at or above 20% usage
//   /UsageWarning 20 70    -> warns every key between 20% and 70% usage
//
// Notification sent to the key owner (min is always what's quoted, even
// when a max is also given — e.g. "20 70" still says "at least 20"):
//   🔑 You have used at least <min> percent of your traffic.
//   #GuiKey
//   Please contact @MithraVPNcorp
//
// ONE message sent back to the admin PER qualifying key:
//   #GuiKey
//   Usage/Limit
//   ✅Notification message sent to 123456789 @username
//   -- or --
//   Notification message was failed sending to 123456789 @username
//
// Design notes:
//   - "All available keys" is read literally: every row in UserKeys for
//     every configured server, with NO age cutoff.
//   - Keys with no configured DataLimit (Outline "no limit" keys) can't
//     have a usage PERCENTAGE computed, so they're skipped entirely.
//   - Keys that no longer exist on their server (Expired) are skipped —
//     there's no usage to evaluate.
//   - Sends (both to key owners AND the per-key admin reports) are paced
//     with a small delay to avoid bursting past Telegram's outbound rate
//     limits when many warnings go out in one run.
const { getKeysUsage, formatBytes } = require('./getKeysUsage');

const registry = require('./commandRegistry');
registry.register('/UsageWarning [min] [max]', 'scans usage %, notifies affected users', ['superadmin', 'admin']);
// Usage:
//   SEND_DELAY_MS paces each outbound message (both to key owners and to
//   the admin's per-key report messages).
const SEND_DELAY_MS = 35;

// Usage:
//   await sleep(35) -> resolves after 35ms
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Usage:
//   escapeHtml('<script>') -> '&lt;script&gt;'
//
// Now that the per-key admin report uses parse_mode: 'HTML' (for the
// tap-to-copy <code> UserID), any interpolated text that ISN'T meant to
// be markup needs escaping so it can't accidentally break the HTML or
// get swallowed by the parser.
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = function registerUsageWarningCommand(bot, deps) {
    const { db, SERVERS, axios, https } = deps;

    bot.onText(/^\/UsageWarning(?:\s+(\d+))?(?:\s+(\d+))?$/i, async (msg, match) => {
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

            // --- No arguments: show usage instructions, don't scan or send anything ---
            if (match[1] === undefined) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ Usage:\n" +
                    "/UsageWarning <min>          - warn keys at or above <min>% usage\n" +
                    "/UsageWarning <min> <max>    - warn keys between <min>% and <max>% usage\n\n" +
                    "Example: /UsageWarning 20\n" +
                    "Example: /UsageWarning 20 70"
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
                    console.error(`UsageWarning: usage fetch failed for ${serverName}:`, err.message);
                    await bot.sendMessage(chatId, `${serverName}: ⚠️ Failed to reach server API: ${err.message}`);
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

                    // Notification always quotes <min>, even for a range —
                    // "at least <min> percent", per request.
                    const notificationText =
                        `🔑 You have used at least ${minPercent} percent of your traffic.\n` +
                        `${guiKey}\n` +
                        `Please contact @MithraVPNcorp`;

                    let sendResultLine;
                    try {
                        await bot.sendMessage(row.UserID, notificationText);
                        sendResultLine = `✅Notification message sent to <code>${row.UserID}</code> ${nameForReport}`;
                    } catch (err) {
                        console.error(`UsageWarning: failed to notify UserID ${row.UserID}:`, err.message);
                        sendResultLine = `Notification message was failed sending to <code>${row.UserID}</code> ${nameForReport}`;
                    }

                    // ONE separate message per flagged key, sent to the admin.
                    // parse_mode: 'HTML' makes the <code>-wrapped UserID tap-to-copy.
                    await bot.sendMessage(chatId, `${guiKey}\n${usageText}\n${sendResultLine}`, { parse_mode: 'HTML' });

                    // Pace outbound sends to stay under Telegram's rate limits
                    await sleep(SEND_DELAY_MS);
                }
            }

            await bot.sendMessage(
                chatId,
                `📋 Scan complete (${rangeLabel}).\nChecked: ${scannedKeys} key(s) | Flagged: ${flaggedKeys}`
            );

        } catch (err) {
            console.error('/UsageWarning error:', err);
            await bot.sendMessage(chatId, '⚠️ Internal error occurred during usage warning scan.');
        }
    });
};
