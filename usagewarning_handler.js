// usagewarning_handler.js
//
// Usage:
//   const registerUsageWarningCommand = require('./usagewarning_handler');
//   registerUsageWarningCommand(bot, { db, SERVERS, axios, https });
//
// Registers "/UsageWarning" — scans every key across every server and, for
// any key that has used 90% or more of its configured data limit, sends
// that key's owner a warning message. Reports back to the admin who ran
// it, per key that triggered a warning, whether the notification actually
// sent.
//
// ACCESS: superadmin + admin (moderator excluded) — same gate as
// /servercheck, since this is a similarly broad, cross-user operation.
//
// Notification sent to the key owner:
//   🔑 You have used more than %90 percent of your traffic.
//   #GuiKey
//   Please contact @MithraVPNcorp
//
// Report sent back to the admin, per qualifying key:
//   #GuiKey
//   Usage/Limit
//   ✅Notification message sent to UserID 123456789 @username
//   -- or --
//   Notification message was failed sending to UserID 123456789 @username
//
// Design notes:
//   - "All available keys" is read literally: every row in UserKeys for
//     every configured server, with NO age cutoff (unlike /ks's 45-day
//     or /servercheck's 60-day windows). If you'd rather restrict this to
//     recent keys only, add an IssuedAt filter to the SQL below.
//   - Keys with no configured DataLimit (Outline "no limit" keys) can't
//     have a usage PERCENTAGE computed, so they're skipped entirely —
//     they never trigger a warning regardless of raw bytes used.
//   - Keys that no longer exist on their server (i.e. would show
//     "Expired" in /servercheck) are also skipped — there's no usage to
//     evaluate and no reason to warn an owner about a key that's gone.
//   - Sends are paced with a small delay (see SEND_DELAY_MS), same
//     reasoning as /broadcast: avoid bursting past Telegram's outbound
//     rate limits when many warnings go out in one run.
const { getKeysUsage, formatBytes } = require('./getKeysUsage');

// Usage:
//   WARNING_THRESHOLD = 0.9 means "90% of the configured data limit"
const WARNING_THRESHOLD = 0.9;

// Usage:
//   SEND_DELAY_MS paces each outbound warning message, same reasoning as
//   /broadcast's rate-limit pacing.
const SEND_DELAY_MS = 35;

// Usage:
//   await sleep(35) -> resolves after 35ms
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Usage:
//   await sendInChunks(bot, chatId, longText)
//
// Splits a long report into multiple messages so it doesn't get rejected
// by Telegram's ~4096 char message limit when many keys are flagged.
async function sendInChunks(bot, chatId, text) {
    const CHUNK_SIZE = 3500;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        await bot.sendMessage(chatId, text.slice(i, i + CHUNK_SIZE));
    }
}

module.exports = function registerUsageWarningCommand(bot, deps) {
    const { db, SERVERS, axios, https } = deps;

    bot.onText(/^\/UsageWarning$/i, async (msg) => {
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

            const serverNames = Object.keys(SERVERS);
            if (serverNames.length === 0) {
                await bot.sendMessage(chatId, 'ℹ️ No servers configured.');
                return;
            }

            await bot.sendMessage(
                chatId,
                `🔎 Scanning ${serverNames.length} server(s) for keys at or above ${Math.round(WARNING_THRESHOLD * 100)}% usage...`
            );

            const reportLines = [];
            let scannedKeys = 0;
            let flaggedKeys = 0;

            for (const serverName of serverNames) {
                // Pull every DB-tracked key for this server, with its
                // owner's Username for reporting.
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
                    reportLines.push(`${serverName}: ⚠️ Failed to reach server API: ${err.message}`);
                    continue;
                }

                for (const row of rows) {
                    scannedKeys++;
                    const guiKey = (row.GuiKey || '').trim();
                    if (!guiKey) continue;

                    const info = usageMap.get(guiKey);
                    // No info -> key no longer exists on the server (Expired) -> skip.
                    // No limitBytes -> "no limit" key, can't compute a percentage -> skip.
                    if (!info || !info.limitBytes) continue;

                    const percent = info.bytes / info.limitBytes;
                    if (percent < WARNING_THRESHOLD) continue;

                    flaggedKeys++;
                    const usageText = `${formatBytes(info.bytes)}/${formatBytes(info.limitBytes)}`;
                    const nameForReport = row.Username ? `@${row.Username}` : 'No Username';

                    const notificationText =
                        `🔑 You have used more than %90 percent of your traffic.\n` +
                        `${guiKey}\n` +
                        `Please contact @MithraVPNcorp`;

                    let sendResultLine;
                    try {
                        await bot.sendMessage(row.UserID, notificationText);
                        sendResultLine = `✅Notification message sent to UserID ${row.UserID} ${nameForReport}`;
                    } catch (err) {
                        console.error(`❌UsageWarning: failed to notify UserID ${row.UserID}:`, err.message);
                        sendResultLine = `❌Notification message was failed sending to UserID ${row.UserID} ${nameForReport}`;
                    }

                    reportLines.push(`${guiKey}\n${usageText}\n${sendResultLine}`);

                    // Pace outbound sends to stay under Telegram's rate limits
                    await sleep(SEND_DELAY_MS);
                }
            }

            if (reportLines.length === 0) {
                await bot.sendMessage(
                    chatId,
                    `✅ Scan complete. ${scannedKeys} key(s) checked, none at or above ${Math.round(WARNING_THRESHOLD * 100)}%.`
                );
                return;
            }

            const report =
                `📋 Usage warning scan complete.\n` +
                `Checked: ${scannedKeys} key(s) | Flagged: ${flaggedKeys}\n\n` +
                reportLines.join('\n\n');

            await sendInChunks(bot, chatId, report);

        } catch (err) {
            console.error('/UsageWarning error:', err);
            await bot.sendMessage(chatId, '⚠️ Internal error occurred during usage warning scan.');
        }
    });
};
