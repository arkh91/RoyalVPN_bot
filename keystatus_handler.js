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
//   /keystatus <wireguard key> -> "under development" message
//   anything else               -> "no matching key found"
//
// How Outline vs WireGuard is decided:
//   1) First we check whether the argument matches ANY row in UserKeys
//      (by FullKey, or by GuiKey with/without a leading '#'), across all
//      users. A match means it's an Outline key we manage — handle it
//      fully.
//   2) If there's no DB match, we check whether the string LOOKS like a
//      WireGuard key: a 43-44 char base64 blob ending in '=', with none
//      of the markers an Outline key/tag would have (no "ss://", no "#").
//      WireGuard peers aren't tracked in UserKeys yet, so we can't look
//      them up — we just acknowledge the format and say it's pending.
//   3) Otherwise, we don't recognize it at all.
const { getKeysUsage, formatBytes } = require('./getKeysUsage');

// Usage:
//   looksLikeWireGuardKey('abc123...==') -> true/false
//
// WireGuard public/private keys are 32 raw bytes, base64-encoded -> always
// 44 characters with a trailing '='. Outline identifiers either start with
// "ss://" (FullKey) or "#" (GuiKey), so excluding those avoids false
// positives if an Outline key happens to be base64-shaped.
function looksLikeWireGuardKey(input) {
    return /^[A-Za-z0-9+/]{43}=$/.test(input)
        && !input.startsWith('ss://')
        && !input.includes('#');
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

                let usageText = "N/A";
                try {
                    const usageMap = await getKeysUsage(ServerName, SERVERS, axios, https);
                    const info = usageMap.get(GuiKey.trim());
                    usageText = info
                        ? (info.limitBytes
                            ? `${formatBytes(info.bytes)} / ${formatBytes(info.limitBytes)}`
                            : `${formatBytes(info.bytes)} (no limit)`)
                        : "N/A";
                } catch (err) {
                    console.error(`Usage fetch failed for ${ServerName}:`, err.message);
                }

                const message =
                    `👤 Owner UserID: <code>${escapeHtml(String(UserID))}</code>\n` +
                    `🔑 Key: <code>${escapeHtml(FullKey)}</code>\n` +
                    `Status: ${statusText}\n` +
                    `Usage: ${escapeHtml(usageText)}`;

                await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
                return;
            }

            // --- 2) Not an Outline key we manage — does it look like WireGuard? ---
            if (looksLikeWireGuardKey(input)) {
                await bot.sendMessage(chatId, "🚧 WireGuard key status is under development.");
                return;
            }

            // --- 3) Neither matched nor recognized ---
            await bot.sendMessage(chatId, "❌ No matching key found. Please check the key and try again.");

        } catch (err) {
            console.error("/keystatus error:", err);
            await bot.sendMessage(chatId, "⚠️ Error checking key status. Please try again later.");
        }
    });
};
