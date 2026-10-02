// WGtestserveriran_handler.js
//
// Usage:
//   const registerWGTestServerIranCommand = require('./WGtestserveriran_handler');
//   registerWGTestServerIranCommand(bot, { db, createWireGuardKeys });
//
// Registers "/wgtestserveriran <ServerAlias>" and its alias
// "/wgtsi <ServerAlias>" — same as /wgtestserver, but issues the test key
// with isInternational: false, so the client's Endpoint line in the
// generated .conf points at PublicURLIran instead of
// PublicURLInternational. This is a SEPARATE command from
// /wgtestserver (rather than a flag on it) so an admin never has to
// remember to pass an extra argument to pick the endpoint — the command
// name itself says which one they're getting.
//
// ACCESS: superadmin, admin, moderator (any active admin).
//
// Rate limits (tracked in TestKeys, keyed by AdminUserID):
//   superadmin -> unlimited
//   admin      -> 1 per calendar day
//   moderator  -> 1 per calendar month
//
// Usage example:
//   /wgtsi uk42
//   /wgtestserveriran Uk42
//
// Design notes:
//   - IMPORTANT ASSUMPTION: this shares the SAME TestKeys allowance as
//     BOTH /testserver (Outline) AND /wgtestserver — all three draw
//     from one shared 1/day (admin) or 1/month (moderator) pool, not
//     three separate ones. So testing both the international and Iran
//     endpoints back-to-back in the same day, as an admin, will hit
//     the rate limit on the second call. Only superadmin is exempt.
//     Say the word if these should be split into independent quotas
//     (needs a KeyType column on TestKeys).
//   - The management API call inside createWireGuardKeys() ALWAYS goes
//     out over PublicURLInternational regardless of isInternational —
//     that flag only changes which hostname gets written into the
//     client's Endpoint line (see requestNewPeer() in WGKeyCreation.js).
//     So resolveServerAlias's BearerToken filter (below) is still the
//     right and only credential check needed here — PublicURLIran being
//     unreachable from the bot host, if that's ever the case, wouldn't
//     be caught by this filter, only by the API call itself failing.
//   - Everything else (rate limiting, admin check, alias resolution,
//     message/file format) is identical to WGtestserver_handler.js —
//     see that file's comments for the full reasoning.
const registry = require('./commandRegistry');
registry.register('/wgtestserveriran <ServerAlias> or /wgtsi <ServerAlias>', 'issue yourself a 1GB/30-day WireGuard test key using the PublicURLIran endpoint (rate-limited by role)', ['superadmin', 'admin', 'moderator']);

/**
 * Case-insensitively matches `input` against vpn_servers rows that are
 * BOTH Status = 'ACTIVE' AND actually have WireGuard configured on them
 * (BearerToken set). Same filter as WGtestserver_handler.js — see that
 * file's comments for why Status alone isn't enough (vpn_servers is
 * shared with Outline, with no separate "Type" column).
 *
 * Usage:
 *   const alias = await resolveServerAlias('uk42', db); // -> 'Uk42' or null
 */
async function resolveServerAlias(input, db) {
    const [rows] = await db.execute(
        "SELECT ServerAlias FROM vpn_servers WHERE Status = 'ACTIVE' AND BearerToken IS NOT NULL"
    );
    const target = input.toLowerCase();
    for (const row of rows) {
        if (row.ServerAlias.toLowerCase() === target) return row.ServerAlias;
    }
    return null;
}

module.exports = function registerWGTestServerIranCommand(bot, deps) {
    const { db, createWireGuardKeys } = deps;

    bot.onText(/^\/(wgtestserveriran|wgtsi)(?:\s+(\S+))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const rawServerAlias = match[2];

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

            if (!rawServerAlias) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ Usage: /wgtestserveriran <ServerAlias>  (alias: /wgtsi <ServerAlias>)\n" +
                    "Example: /wgtsi Uk42\n\n" +
                    "Issues a 1GB / 30-day WireGuard test key using the PublicURLIran endpoint. Limits: superadmin unlimited, admin 1/day, moderator 1/month (shared with /wgtestserver)."
                );
                return;
            }

            const serverAlias = await resolveServerAlias(rawServerAlias, db);
            if (!serverAlias) {
                await bot.sendMessage(chatId, `❌ Unknown or inactive server: ${rawServerAlias}`);
                return;
            }

            // --- Rate limit check (skipped entirely for superadmin) ---
            if (role !== 'superadmin') {
                let windowStart;
                let windowLabel;

                if (role === 'admin') {
                    windowStart = 'CURDATE()';
                    windowLabel = 'today';
                } else if (role === 'moderator') {
                    windowStart = "DATE_FORMAT(NOW(), '%Y-%m-01')";
                    windowLabel = 'this month';
                } else {
                    await bot.sendMessage(chatId, '❌ Error: Unrecognized role.');
                    return;
                }

                const [countRows] = await db.execute(
                    `SELECT COUNT(*) AS cnt FROM TestKeys WHERE AdminUserID = ? AND IssuedAt >= ${windowStart}`,
                    [senderId]
                );

                if (countRows[0].cnt > 0) {
                    await bot.sendMessage(
                        chatId,
                        `❌ You've already used your test key allowance for ${windowLabel} (${role}: ${role === 'admin' ? '1/day' : '1/month'}).`
                    );
                    return;
                }
            }

            // --- Create the key (reusing the same path real WG purchases use) ---
            const peers = await createWireGuardKeys({
                serverAlias,
                userId: senderId,
                deviceCount: 1,
                bandwidthGb: 1,         // 1 GB test allowance
                isInternational: false, // <- the only functional difference from WGtestserver_handler.js: Endpoint uses PublicURLIran
                validDays: 30
            });
            const peer = peers[0];

            // --- Record this issuance for rate-limiting future calls ---
            await db.execute(
                "INSERT INTO TestKeys (AdminUserID, ServerName) VALUES (?, ?)",
                [senderId, serverAlias]
            );

            const caption =
                `✅ *WireGuard Test Config — Iran endpoint (1GB / 30 days)*\n\n` +
                `\`#${peer.name}\`\n\n` +
                `\`\`\`\n${peer.config}\n\`\`\``;

            await bot.sendDocument(
                chatId,
                Buffer.from(peer.config, 'utf8'),
                {
                    caption,
                    parse_mode: 'Markdown'
                },
                {
                    filename: `${peer.fileName}.conf`,
                    contentType: 'text/plain'
                }
            );

        } catch (err) {
            console.error('/wgtestserveriran error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.message || err.code}`);
        }
    });
};
