// servercheck_handler.js
//
// Usage:
//   const registerServerCheckCommand = require('./servercheck_handler');
//   registerServerCheckCommand(bot, { db, SERVERS, axios, https });
//
// Registers "/servercheck" and its alias "/sc" — for every server in
// SERVERS, cross-checks each GuiKey issued in the last 60 days that we
// have on record in UserKeys against what's actually still present on
// that Outline server, and reports:
//   - Usage/Limit for keys that still exist on the server
//   - "Expired" for keys we have in the DB but that are no longer on
//     the server (i.e. removed/expired on the Outline side)
//
// ACCESS: superadmin and admin only (NOT moderator).
//
// Output: one Telegram message PER SERVER, e.g.:
//   Ger27:
//   Active keys: 12/15
//
//   #Ger27_07142026_150423 (UserID: 2111341864)
//   68.36 GB/73.40 GB
//
//   #Ger27_06182026_230629 (UserID: 2111341864)
//   Expired
//   ...
//
// Design notes:
//   - Existence + usage both come from a SINGLE getKeysUsage() call per
//     server (2 Outline API calls total: /access-keys + /metrics/transfer)
//     rather than calling KeyExists() once per key, which would mean one
//     API round-trip PER KEY — with some servers tracking 100+ keys in
//     this DB, that difference is the difference between ~2 API calls
//     and ~200 per server.
//   - A key counts as "still on the server" if its GuiKey (verbatim,
//     trimmed) is present in that server's usage map — the same lookup
//     /ks and /keystatus already use, so results stay consistent across
//     commands.
//   - Servers with no DB-tracked keys are skipped (no empty message sent).
//   - If a server's API is unreachable, that server's message reports the
//     error instead of silently skipping it or crashing the whole command.
const { getKeysUsage, formatBytes } = require('./getKeysUsage');

// Usage:
//   await sendInChunks(bot, chatId, longText)
//
// Telegram messages cap out around 4096 chars. A single server can have
// well over 100 tracked keys, so its report may need to be split into
// multiple messages instead of one call the API would reject.
async function sendInChunks(bot, chatId, text) {
    const CHUNK_SIZE = 3500;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        await bot.sendMessage(chatId, text.slice(i, i + CHUNK_SIZE));
    }
}

module.exports = function registerServerCheckCommand(bot, deps) {
    const { db, SERVERS, axios, https } = deps;

    bot.onText(/^\/(servercheck|sc)$/i, async (msg) => {
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

            await bot.sendMessage(chatId, `🔎 Running server check across ${serverNames.length} server(s)...`);

            for (const serverName of serverNames) {
                // --- Keys we have on record for this server, issued in the
                // last 60 days ---
                const [rows] = await db.execute(
                    `SELECT UserID, GuiKey
                     FROM UserKeys
                     WHERE ServerName = ?
                       AND IssuedAt >= NOW() - INTERVAL 60 DAY`,
                    [serverName]
                );

                // Nothing tracked for this server — skip, don't send an
                // empty report.
                if (rows.length === 0) continue;

                // --- Live usage/limit + existence, from the Outline server ---
                let usageMap;
                try {
                    usageMap = await getKeysUsage(serverName, SERVERS, axios, https);
                } catch (err) {
                    console.error(`servercheck: usage fetch failed for ${serverName}:`, err.message);
                    await bot.sendMessage(
                        chatId,
                        `${serverName}:\n⚠️ Failed to reach server API: ${err.message}`
                    );
                    continue;
                }

                let activeCount = 0;
                const lines = [];

                for (const row of rows) {
                    const guiKey = (row.GuiKey || '').trim();
                    if (!guiKey) continue;

                    const info = usageMap.get(guiKey);
                    const header = `${guiKey} (UserID: ${row.UserID})`;

                    if (!info) {
                        lines.push(`${header}\nExpired`);
                        continue;
                    }

                    activeCount++;
                    const usageText = info.limitBytes
                        ? `${formatBytes(info.bytes)}/${formatBytes(info.limitBytes)}`
                        : `${formatBytes(info.bytes)} (no limit)`;
                    lines.push(`${header}\n${usageText}`);
                }

                const message =
                    `${serverName}:\n` +
                    `Active keys: ${activeCount}/${rows.length}\n\n` +
                    lines.join('\n\n');

                await sendInChunks(bot, chatId, message);
            }

        } catch (err) {
            console.error('/servercheck error:', err);
            await bot.sendMessage(chatId, '⚠️ Internal error occurred during server check.');
        }
    });
};
