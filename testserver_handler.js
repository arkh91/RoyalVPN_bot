// testserver_handler.js
//
// Usage:
//   const registerTestServerCommand = require('./testserver_handler');
//   registerTestServerCommand(bot, { db, SERVERS, createNewKey });
//
// Registers "/testserver <ServerName>" and its alias "/ts <ServerName>"
// — issues a personal 1GB / 30-day Outline test key on the given server
// for the caller themselves (tied to their own Telegram UserID, same as
// a normal purchase), rate-limited per role using a new TestKeys table.
//
// ACCESS: superadmin, admin, moderator (any active admin).
//
// Rate limits (tracked in TestKeys, keyed by AdminUserID):
//   superadmin -> unlimited
//   admin      -> 1 per calendar day
//   moderator  -> 1 per calendar month
//
// Usage example:
//   /ts ger28
//   /testserver Ger28
//
// Design notes:
//   - Reuses the existing createNewKey(serverName, userId, bandwidthGb)
//     function — the same one every real purchase flow in main.js calls
//     — instead of reimplementing Outline API calls. This guarantees the
//     resulting key's GuiKey tag format, data-limit setting, and
//     UserKeys row match what every other key-creation path produces.
//   - ExpiredAt is explicitly set to NOW() + 30 days AFTER createNewKey
//     runs, as a defensive measure — this file doesn't assume
//     createNewKey already sets a 30-day expiry internally, since that
//     internal behavior wasn't directly inspected when writing this.
//     If createNewKey turns out to already set ExpiredAt correctly on
//     its own, this UPDATE is redundant but harmless (it just re-sets
//     the same target date).
//   - ServerName lookup is case-insensitive against the SERVERS config
//     keys (e.g. typing "ger28" resolves to "Ger28"), since admins will
//     naturally type it in whatever casing is convenient.
//   - The test key is tied to UserID = the admin/mod's OWN Telegram ID,
//     so it shows up in their own /ks like any other key they hold.
const registry = require('./commandRegistry');
registry.register('/testserver <ServerName> or /ts <ServerName>', 'issue yourself a 1GB/30-day test key (rate-limited by role)', ['superadmin', 'admin', 'moderator']);

// Usage:
//   resolveServerName('ger28', SERVERS) -> 'Ger28' or null
function resolveServerName(input, SERVERS) {
    const target = input.toLowerCase();
    for (const name of Object.keys(SERVERS)) {
        if (name.toLowerCase() === target) return name;
    }
    return null;
}

module.exports = function registerTestServerCommand(bot, deps) {
    const { db, SERVERS, createNewKey } = deps;

    bot.onText(/^\/(testserver|ts)(?:\s+(\S+))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const rawServerName = match[2];

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

            if (!rawServerName) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ Usage: /testserver <ServerName>  (alias: /ts <ServerName>)\n" +
                    "Example: /ts Ger28\n\n" +
                    "Issues a 1GB / 30-day test key. Limits: superadmin unlimited, admin 1/day, moderator 1/month."
                );
                return;
            }

            const serverName = resolveServerName(rawServerName, SERVERS);
            if (!serverName) {
                await bot.sendMessage(chatId, `❌ Unknown server: ${rawServerName}`);
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

            // --- Create the key (reusing the same path real purchases use) ---
            const newKey = await createNewKey(serverName, senderId, 1); // 1 GB

            // --- Explicitly (re-)set 30-day expiry, defensively ---
            await db.execute(
                "UPDATE UserKeys SET ExpiredAt = DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE FullKey = ?",
                [newKey]
            );

            // --- Record this issuance for rate-limiting future calls ---
            await db.execute(
                "INSERT INTO TestKeys (AdminUserID, ServerName) VALUES (?, ?)",
                [senderId, serverName]
            );

            await bot.sendMessage(
                chatId,
                `✅ Test key created on ${serverName} (1GB, expires in 30 days):\n\`${newKey}\``,
                { parse_mode: 'Markdown' }
            );

        } catch (err) {
            console.error('/testserver error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.message || err.code}`);
        }
    });
};
