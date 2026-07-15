// keystatus_handler.js
//
// Usage:
//   const registerKeyStatusCommand = require('./keystatus_handler');
//   registerKeyStatusCommand(bot, { db, KeyExists, SERVERS, axios, https });
//
// Registers "/keystatus <key>" (lowercase — distinct from the existing
// legacy "/KeyStatus" flow elsewhere in this codebase, which is untouched).
//
// Behavior:
//   /keystatus                -> "argument required" usage message
//   /keystatus <outline key>  -> FullKey + Active/Not Active + Usage
//                                (looked up in UserKeys, scoped to the
//                                 sender's own UserID — same as /ks)
//   /keystatus <wireguard key> -> "under development" message
//   anything else              -> "no matching key found"
//
// How Outline vs WireGuard is decided:
//   1) First we check whether the argument matches a row in UserKeys for
//      THIS user (by FullKey, or by GuiKey with/without a leading '#').
//      A match means it's an Outline key we manage — handle it fully.
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

module.exports = function registerKeyStatusCommand(bot, deps) {
    const { db, KeyExists, SERVERS, axios, https } = deps;

    bot.onText(/^\/keystatus(?:\s+([\s\S]+))?$/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const input = match[1] ? match[1].trim() : '';

        // --- No argument supplied ---
        if (!input) {
            return bot.sendMessage(
                chatId,
                "⚠️ Usage: /keystatus <key>\nPlease provide your Outline or WireGuard key."
            );
        }

        try {
            // --- 1) Try to resolve as one of the user's own Outline keys ---
            const altGui = input.startsWith('#') ? input.substring(1).trim() : ('#' + input);

            const [rows] = await db.execute(
                `SELECT FullKey, GuiKey, ServerName, IssuedAt
                 FROM UserKeys
                 WHERE UserID = ?
                   AND (FullKey = ? OR GuiKey = ? OR GuiKey = ?)
                 LIMIT 1`,
                [userId, input, input, altGui]
            );

            if (rows.length > 0) {
                const { FullKey, GuiKey, ServerName } = rows[0];

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
                    `🔑 Key: <code>${escapeHtml(FullKey)}</code>\n` +
                    `Status: ${statusText}\n` +
                    `Usage: ${escapeHtml(usageText)}`;

                return bot.sendMessage(chatId, message, { parse_mode: "HTML" });
            }

            // --- 2) Not an Outline key we manage — does it look like WireGuard? ---
            if (looksLikeWireGuardKey(input)) {
                return bot.sendMessage(chatId, "🚧 WireGuard key status is under development.");
            }

            // --- 3) Neither matched nor recognized ---
            return bot.sendMessage(chatId, "❌ No matching key found. Please check the key and try again.");

        } catch (err) {
            console.error("/keystatus error:", err);
            await bot.sendMessage(chatId, "⚠️ Error checking key status. Please try again later.");
        }
    });
};
