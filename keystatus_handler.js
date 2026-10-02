// keystatus_handler.js
//
// Usage:
//   const registerKeyStatusCommand = require('./keystatus_handler');
//   registerKeyStatusCommand(bot, { db, KeyExists, SERVERS, axios, https });
//
// Registers "/keystatus <key>" (lowercase — distinct from the existing
// legacy "/KeyStatus" flow elsewhere in this codebase, which is untouched).
//
// Access: superadmin / admin / moderator ONLY (checked against the Admins
// table, same pattern as /keyusername, /removekey, etc.). This is a
// deliberate cross-user lookup tool — it searches every key in UserKeys
// regardless of who owns it, not just the caller's own keys — so it must
// stay behind the same admin gate as the other lookup commands, or any
// user could enumerate the status/usage of a key they don't own.
//
// Behavior:
//   /keystatus                 (non-admin) -> "not an active admin" error
//   /keystatus                 (admin, no arg) -> "argument required"
//   /keystatus <outline key>   -> Owner UserID + FullKey + Active/Not
//                                 Active + Usage (looked up across ALL
//                                 users' keys)
//   /keystatus <wireguard key or name> -> 🔌 [WG] Owner UserID + Name +
//                                 Server + Active/Not Active + Usage,
//                                 plus the full reconstructed .conf in a
//                                 tap-to-copy block (looked up across ALL
//                                 users' wg_clients rows)
//   anything else               -> "no matching key found"
//
// How Outline vs WireGuard is decided:
//   1) First we check whether the argument matches ANY row in UserKeys
//      (by FullKey, or by GuiKey with/without a leading '#'), across all
//      users. A match means it's an Outline key we manage — handle it
//      fully.
//   2) If there's no Outline match, we check whether the argument matches
//      ANY row in wg_clients, across all users — by exact public_key,
//      exact private_key (so pasting either straight out of a .conf file
//      works), or by the friendly name tag (e.g. "Ger28_09262026_143012",
//      matched with a leading '#' and the trailing flag emoji ignored —
//      see normalizeWgNameToken below). A match means it's a WireGuard
//      client we manage — handle it fully, straight from the DB: unlike
//      Outline, WireGuard usage/status is already tracked in wg_clients
//      (is_active/is_expired/is_suspended/total_bytes/max_data_limit),
//      so no live API round-trip is needed here.
//   3) Otherwise, we don't recognize it at all.
const { getKeysUsage, formatBytes } = require('./getKeysUsage');

const registry = require('./commandRegistry');
registry.register('/keystatus <key>', "look up any key's owner, status, usage", ['superadmin', 'admin', 'moderator']);

// Usage:
//   normalizeWgNameToken('#Ger28_09262026_143012🇩🇪') -> 'ger28_09262026_143012'
//   normalizeWgNameToken('Ger28_09262026_143012')      -> 'ger28_09262026_143012'
//
// wg_clients.name is built as "<alias>_<MMDDYYYY>_<HHMMSS>[_devN]<flag>"
// with NO space before the flag emoji (see createWireGuardKeys() in
// db/WGKeyCreation.js) — unlike Outline's GuiKey, which has one. A user
// won't have the flag emoji handy to paste back, and may or may not
// include the leading '#' Telegram displayed it with, so this strips
// both: drop a leading '#', keep only the leading run of
// [A-Za-z0-9_] characters (which is always exactly the flag-free name),
// and lowercase it for a case-insensitive match.
function normalizeWgNameToken(value) {
    const noHash = String(value).trim().replace(/^#/, '');
    const match = noHash.match(/^[A-Za-z0-9_]+/);
    return (match ? match[0] : noHash).toLowerCase();
}

// Usage:
//   isWgClientActive(wgRow) -> true/false
//
// Mirrors the same definition used for /keyusername and /keyuserid in
// commands.js — duplicated here rather than imported, matching this
// file's existing preference (see escapeHtml above) for having no
// hidden cross-file dependency on another handler's internals.
function isWgClientActive(client) {
    return !!client.is_active && !client.is_expired && !client.is_suspended && !client.is_deleted;
}

// Usage:
//   escapeHtml('<script>') -> '&lt;script&gt;'
//
// Same escaping used by /ks, kept local here so this file has no hidden
// dependency on another handler's internals.
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Usage:
//   const configText = buildWgConfigText(wgRow);
//   `<pre>${escapeHtml(configText)}</pre>`   // tap-to-copy in Telegram
//
// wg_clients has no single "full config" column — private_key, address,
// dns, public_key, endpoint and allowed_ips are separate columns (see
// db/WGKeyCreation.js's saveClientToDB). This rebuilds the exact .conf
// text from those columns, the same shape the customer received when
// the key was issued, so an admin can tap-to-copy it straight out of
// Telegram to test the key. Same helper as /keyusername and /keyuserid
// in commands.js — duplicated here rather than imported, matching this
// file's existing convention (see escapeHtml/isWgClientActive above).
//
// PersistentKeepalive isn't stored anywhere (the WireGuard server's
// /create response never included it), so it's appended as a fixed
// line — 25 seconds is the standard keepalive for clients behind NAT.
function buildWgConfigText(client) {
    return (
        `[Interface]\n` +
        `PrivateKey = ${client.private_key}\n` +
        `Address = ${client.address}\n` +
        `DNS = ${client.dns}\n\n` +
        `[Peer]\n` +
        `PublicKey = ${client.public_key}\n` +
        `Endpoint = ${client.endpoint}\n` +
        `AllowedIPs = ${client.allowed_ips}\n` +
        `PersistentKeepalive = 25`
    );
}

// Usage:
//   catch (err) { await bot.sendMessage(chatId, `Error: ${telegramErrorDetail(err)}`); }
//
// node-telegram-bot-api always sets err.code to the generic 'ETELEGRAM'
// for ANY rejected API call — a bad HTML tag, a too-long message, a
// blocked user, all look identical from err.code alone. The actual
// reason Telegram gave lives at err.response.body.description.
function telegramErrorDetail(err) {
    return err?.response?.body?.description || err?.message || err?.code || 'Unknown error';
}

// Usage:
//   normalizeKeyToken('#Ger27_07142026_150423 🇩🇪') -> '#Ger27_07142026_150423'
//   normalizeKeyToken('ss://...@host:22627#Ger27_07142026_150423 🇩🇪')
//     -> 'ss://...@host:22627#Ger27_07142026_150423'
//
// FullKey/GuiKey are stored with a decorative " <flag emoji>" suffix
// appended at key-creation time (e.g. " 🇩🇪" for Germany). That suffix
// is never what a user pastes back in, so an exact SQL match against
// the raw column silently fails. The real identifier is always
// everything before the first whitespace — so we compare on that
// token instead of the raw stored string.
function normalizeKeyToken(value) {
    return String(value).trim().split(/\s+/)[0];
}

module.exports = function registerKeyStatusCommand(bot, deps) {
    const { db, KeyExists, SERVERS, axios, https } = deps;

    bot.onText(/^\/keystatus(?:\s+([\s\S]+))?$/, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const input = match[1] ? match[1].trim() : '';

        try {
            // --- Admin gate: superadmin / admin / moderator only ---
            const [adminRows] = await db.execute(
                "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1",
                [senderId]
            );

            if (adminRows.length === 0) {
                await bot.sendMessage(chatId, '❌ Error: You are not an active admin.');
                return;
            }

            const role = adminRows[0].Role;
            if (!['superadmin', 'admin', 'moderator'].includes(role)) {
                await bot.sendMessage(chatId, '❌ Error: You do not have permission.');
                return;
            }

            // --- No argument supplied ---
            if (!input) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ Usage: /keystatus <key>\nPlease provide an Outline or WireGuard key."
                );
                return;
            }

            // --- 1) Try to resolve as an Outline key belonging to ANY user ---
            //
            // We fetch every key in the table and compare normalized tokens
            // in JS rather than doing an exact SQL match, because FullKey/
            // GuiKey carry a decorative " <flag emoji>" suffix that a pasted
            // key/tag will never include (see normalizeKeyToken above).
            const altGui = input.startsWith('#') ? input.substring(1).trim() : ('#' + input);
            const normalizedInput = normalizeKeyToken(input);
            const normalizedAltGui = normalizeKeyToken(altGui);

            const [allKeys] = await db.execute(
                `SELECT UserID, FullKey, GuiKey, ServerName, IssuedAt
                 FROM UserKeys`
            );

            const rows = allKeys.filter(row => {
                const fullTok = normalizeKeyToken(row.FullKey);
                const guiTok = normalizeKeyToken(row.GuiKey);
                return fullTok === normalizedInput
                    || guiTok === normalizedInput
                    || guiTok === normalizedAltGui;
            });

            if (rows.length > 0) {
                const { UserID, FullKey, GuiKey, ServerName } = rows[0];

                const exists = await KeyExists(ServerName, GuiKey);
                const statusText = exists ? "<b>Active</b>" : "<b>Not Active</b>";

                let usageText = "Unknown (server unreachable)";
                try {
                    const usageMap = await getKeysUsage(ServerName, SERVERS, axios, https);
                    const info = usageMap.get(GuiKey.trim());
                    usageText = info
                        ? (info.limitBytes
                            ? `${formatBytes(info.bytes)} / ${formatBytes(info.limitBytes)}`
                            : `${formatBytes(info.bytes)} (no limit)`)
                        : "<b>Expired</b>";
                } catch (err) {
                    console.error(`Usage fetch failed for ${ServerName}:`, err.message);
                }

                const message =
                    `👤 Owner UserID: <code>${escapeHtml(String(UserID))}</code>\n` +
                    `🔑 Key: <code>${escapeHtml(FullKey)}</code>\n` +
                    `Status: ${statusText}\n` +
                    `Usage: ${usageText}`;

                await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
                return;
            }

            // --- 2) Not an Outline key — try to resolve as a WireGuard
            // client belonging to ANY user (public_key, private_key, or
            // the friendly name tag). ---
            const [wgAllRows] = await db.execute(
                `SELECT UserID, name, public_key, private_key, server_name,
                        address, dns, allowed_ips, endpoint,
                        is_active, is_expired, is_suspended, is_deleted,
                        total_bytes, rx_bytes, tx_bytes, max_data_limit
                 FROM wg_clients`
            );

            const normalizedNameInput = normalizeWgNameToken(input);
            const wgRows = wgAllRows.filter(row => {
                if (input === row.public_key) return true;
                if (input === row.private_key) return true;
                if (normalizedNameInput && normalizeWgNameToken(row.name) === normalizedNameInput) return true;
                return false;
            });

            if (wgRows.length > 0) {
                const client = wgRows[0];
                const statusText = isWgClientActive(client) ? "<b>Active</b>" : "<b>Not Active</b>";

                // Usage comes straight from the row's own stored columns —
                // no live API call, unlike the Outline branch above.
                // WireGuard usage is already tracked in the DB.
                const usedBytes = client.total_bytes != null
                    ? Number(client.total_bytes)
                    : Number(client.rx_bytes || 0) + Number(client.tx_bytes || 0);
                const used = formatBytes(usedBytes);

                let usageText;
                if (client.is_deleted) usageText = `<b>Deleted</b> (${used})`;
                else if (client.is_expired) usageText = `<b>Expired</b> (${used})`;
                else if (client.is_suspended) usageText = `<b>Suspended</b> (${used})`;
                else if (!client.is_active) usageText = `<b>Inactive</b> (${used})`;
                else usageText = client.max_data_limit
                    ? `${used} / ${formatBytes(Number(client.max_data_limit))}`
                    : `${used} (no limit)`;

                const message =
                    `👤 Owner UserID: <code>${escapeHtml(String(client.UserID))}</code>\n` +
                    `🔌 <b>[WG]</b> Key: <code>${escapeHtml(client.name)}</code>\n` +
                    `Server: ${escapeHtml(client.server_name)}\n` +
                    `Status: ${statusText}\n` +
                    `Usage: ${usageText}\n` +
                    `<pre>${escapeHtml(buildWgConfigText(client))}</pre>`;

                await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
                return;
            }

            // --- 3) Neither matched nor recognized ---
            await bot.sendMessage(chatId, "❌ No matching key found. Please check the key and try again.");

        } catch (err) {
            console.error("/keystatus error:", err);
            await bot.sendMessage(chatId, `⚠️ Error checking key status: ${telegramErrorDetail(err)}`);
        }
    });
};
