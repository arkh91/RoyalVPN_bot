// WGtestserver_handler.js
//
// Usage:
//   const registerWGTestServerCommand = require('./WGtestserver_handler');
//   registerWGTestServerCommand(bot, { db, createWireGuardKeys });
//
// Registers "/wgtestserver <ServerAlias>" and its alias "/wgts <ServerAlias>"
// — issues a personal 1GB / 30-day WireGuard test key on the given server
// for the caller themselves (tied to their own Telegram UserID, same as
// a normal purchase), rate-limited per role using the existing TestKeys
// table.
//
// ACCESS: superadmin, admin, moderator (any active admin).
//
// Rate limits (tracked in TestKeys, keyed by AdminUserID):
//   superadmin -> unlimited
//   admin      -> 1 per calendar day
//   moderator  -> 1 per calendar month
//
// Usage example:
//   /wgts uk42
//   /wgtestserver Uk42
//
// Design notes:
//   - Reuses the existing createWireGuardKeys(...) function — the same
//     one every real WireGuard purchase in main.js's wg_bw_ handler
//     calls — instead of reimplementing the /create API call, key
//     derivation, or DB insert. This guarantees the resulting client's
//     name format, wg_clients row, and .conf filename all match what
//     every other WireGuard key-creation path produces.
//   - No defensive "re-set ExpiredAt after the fact" step, unlike the
//     Outline /testserver handler — createWireGuardKeys() is our own
//     function (db/WGKeyCreation.js) and we know for certain it sets
//     expires_at = NOW() + INTERVAL <validDays> DAY on insert, so
//     there's nothing to double-check here.
//   - ServerAlias lookup is case-insensitive against ACTIVE vpn_servers
//     rows, queried fresh on every call — WireGuard servers live in the
//     DB, not a static config object like Outline's SERVERS — so typing
//     "uk42" resolves to whatever casing is actually stored in the
//     ServerAlias column ("Uk42", "UK42", etc).
//   - The test key is tied to UserID = the admin/mod's OWN Telegram ID,
//     so it shows up among their own wg_clients rows like any other key
//     they hold.
//   - IMPORTANT ASSUMPTION: this shares the SAME TestKeys table and
//     allowance as Outline's /testserver. An admin who already used
//     their 1/day Outline test key today can NOT also get a WireGuard
//     one until the window resets — they are not separate quotas. If
//     you'd rather they be independent, TestKeys would need a column
//     (e.g. KeyType ENUM('outline','wireguard')) added to the WHERE
//     clause below and to the INSERT — flag it if you want that added.
const registry = require('./commandRegistry');
registry.register('/wgtestserver <ServerAlias> or /wgts <ServerAlias>', 'issue yourself a 1GB/30-day WireGuard test key (rate-limited by role)', ['superadmin', 'admin', 'moderator']);

/**
 * Case-insensitively matches `input` against vpn_servers rows that are
 * BOTH Status = 'ACTIVE' AND actually have WireGuard configured on them.
 *
 * IMPORTANT: vpn_servers is shared between Outline and WireGuard — a row
 * has both OutlinePort/APIKey columns AND WireGuardPort/BearerToken
 * columns, with no separate "Type" column telling them apart. A server
 * can be Outline-only, WireGuard-only, or both, depending only on which
 * of those credential columns are actually populated. So Status = 'ACTIVE'
 * alone is NOT enough here — an Outline-only row (no BearerToken) would
 * otherwise pass this check and then fail when createWireGuardKeys()
 * actually tries to call its /create endpoint.
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

module.exports = function registerWGTestServerCommand(bot, deps) {
    const { db, createWireGuardKeys } = deps;

    bot.onText(/^\/(wgtestserver|wgts)(?:\s+(\S+))?$/i, async (msg, match) => {
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
                    "⚠️ Usage: /wgtestserver <ServerAlias>  (alias: /wgts <ServerAlias>)\n" +
                    "Example: /wgts Uk42\n\n" +
                    "Issues a 1GB / 30-day WireGuard test key. Limits: superadmin unlimited, admin 1/day, moderator 1/month."
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
                isInternational: true,  // matches main.js's WG flow (PublicURLIran not wired up yet)
                validDays: 30
            });
            const peer = peers[0];

            // --- Record this issuance for rate-limiting future calls ---
            await db.execute(
                "INSERT INTO TestKeys (AdminUserID, ServerName) VALUES (?, ?)",
                [senderId, serverAlias]
            );

            const caption =
                `✅ *WireGuard Test Config (1GB / 30 days)*\n\n` +
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
            console.error('/wgtestserver error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.message || err.code}`);
        }
    });
};
