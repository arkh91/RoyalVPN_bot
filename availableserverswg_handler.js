// availableserverswg_handler.js
//
// Usage:
//   const registerAvailableServersWGCommand = require('./availableserverswg_handler');
//   registerAvailableServersWGCommand(bot, { db });
//
// Registers "/availableserverswg <-all|-active>" and its alias
// "/aswg <-all|-active>" — lists WireGuard servers from the vpn_servers
// table, mainly as a quick reference for which ServerAlias to pass to
// commands like /wgtestserver / /wgtestserveriran.
//
// This REPLACES the old /wgavailableserversoutline ("/wgaso") command —
// same underlying query, renamed per request, plus a required arg:
//   /aswg            -> shows usage (no server list)
//   /aswg -all       -> lists every WireGuard-capable server, any Status
//   /aswg -active    -> lists only Status = 'ACTIVE' WireGuard-capable servers
//   /aswg <anything else> -> "unknown argument" + usage
//
// ACCESS: any active admin (superadmin, admin, or moderator).
//
// Design notes:
//   - vpn_servers is SHARED between Outline and WireGuard: a row has
//     both OutlinePort/APIKey columns AND WireGuardPort/BearerToken
//     columns, with no separate "Type" column telling them apart. A
//     server can be Outline-only, WireGuard-only, or both — it depends
//     only on which of those credential columns are actually populated.
//     So BOTH -all and -active filter on `BearerToken IS NOT NULL`,
//     otherwise Outline-only servers (no BearerToken) would show up
//     here as if they were usable for WireGuard.
//   - "-all" vs "-active" only changes whether the Status filter is
//     applied — -all still only shows WireGuard-capable rows, it just
//     doesn't care whether they're currently ACTIVE, INACTIVE, etc.
//   - Neither mode is a live reachability check — it reads DB state,
//     it does not call each server's /create endpoint. A server
//     showing ACTIVE means /wgtestserver and real purchases CAN use
//     it, not that it's confirmed reachable right now.
//   - Flag emoji comes from the same vpn_servers -> countries JOIN used
//     in db/WGKeyCreation.js's getServerByAlias, so what you see here
//     is guaranteed to match whatever flag ends up in a real client's
//     name.
const registry = require('./commandRegistry');
registry.register('/availableserverswg -all|-active or /aswg -all|-active', 'list configured WireGuard servers (all, or active only)', ['superadmin', 'admin', 'moderator']);

const USAGE_TEXT =
    "⚠️ Usage: /availableserverswg <-all|-active>  (alias: /aswg <-all|-active>)\n\n" +
    "  -all     list every configured WireGuard server, any status\n" +
    "  -active  list only servers currently Status = 'ACTIVE'\n\n" +
    "Example: /aswg -active";

module.exports = function registerAvailableServersWGCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/(availableserverswg|aswg)(?:\s+(\S+))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const rawArg = match[2];

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

            // No arg -> usage only, no query, no list.
            if (!rawArg) {
                await bot.sendMessage(chatId, USAGE_TEXT);
                return;
            }

            const arg = rawArg.toLowerCase();
            if (arg !== '-all' && arg !== '-active') {
                await bot.sendMessage(chatId, `❌ Unknown argument: ${rawArg}\n\n${USAGE_TEXT}`);
                return;
            }

            const onlyActive = arg === '-active';
            const statusClause = onlyActive ? "AND vs.Status = 'ACTIVE'" : '';

            const [servers] = await db.execute(
                `SELECT vs.ServerAlias, vs.ServerName, vs.Country, vs.City, vs.Status,
                        c.FlagEmoji AS CountryFlag
                 FROM vpn_servers vs
                 LEFT JOIN countries c ON c.CountryName = vs.Country
                 WHERE vs.BearerToken IS NOT NULL ${statusClause}
                 ORDER BY vs.ServerAlias ASC`
            );

            if (servers.length === 0) {
                await bot.sendMessage(
                    chatId,
                    onlyActive
                        ? 'ℹ️ No ACTIVE WireGuard servers configured.'
                        : 'ℹ️ No WireGuard servers configured.'
                );
                return;
            }

            const header = onlyActive
                ? `🌐 Active WireGuard Servers (${servers.length}):\n\n`
                : `🌐 All WireGuard Servers (${servers.length}):\n\n`;

            let message = header;
            servers.forEach((server, i) => {
                const flag = server.CountryFlag || '';
                const location = [server.City, server.Country].filter(Boolean).join(', ') || 'Unknown location';
                message += `${i + 1}. ${server.ServerAlias} ${flag} — ${location} [${server.Status}]\n`;
            });

            await bot.sendMessage(chatId, message.trim());

        } catch (err) {
            console.error('/availableserverswg error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.message || err.code}`);
        }
    });
};
