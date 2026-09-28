// wgremovekeys_handler.js
//
// Usage:
//   const registerWgRemoveKeysCommands = require('./wgremovekeys_handler');
//   registerWgRemoveKeysCommands(bot, { db, axios });
//
// Registers TWO commands in one file, per request — they share every
// bit of lookup/removal logic and only differ in what happens to the
// DB row afterward (same relationship /removekey and
// /removekeyexpired.js document for Outline, just consolidated here):
//
//   /wgremovekey <name|publicKey|privateKey>
//     Full removal — WireGuard analogue of /removekey. Removes the peer
//     from its WireGuard server via POST /remove, then permanently
//     DELETEs the row from wg_clients — a true hard delete, same as
//     /removekey does to UserKeys. The row and its usage history are
//     gone, not just flagged.
//
//   /wgremovekeyexpired <name|publicKey|privateKey>
//     Server-side removal only — WireGuard analogue of /removekeyexpired.
//     Removes the peer from its WireGuard server the same way, then
//     marks is_expired = 1 and stamps expires_at = NOW(). The row is
//     NOT deleted here — is_deleted stays 0, so usage/billing history
//     for this client is preserved (this is the one WG command that
//     uses wg_clients' soft-delete-style columns; /wgremovekey does not).
//
// ACCESS: superadmin + admin only (moderator excluded) — same gate as
// both Outline counterparts.
//
// The WireGuard "delete peer" API (confirmed by the person, not
// reverse-engineered):
//   POST {PublicURLInternational}/remove
//   Headers: Authorization: Bearer <BearerToken>, Content-Type: application/json
//   Body:    { "ipAddress": "<client's address, no /32 suffix>" }
// wg_clients.address is stored WITH a CIDR suffix (e.g. "10.66.66.4/32",
// same as the [Interface] Address line in a real .conf), so that suffix
// is stripped before sending.
//
// Design notes:
//   - Lookup matches ACROSS ALL USERS (not just the caller's own keys),
//     same as /removekey and /removekeyexpired — an admin acting on a
//     key a user reported needs this to work regardless of who owns it.
//   - Matches by exact public_key, exact private_key (so pasting either
//     value straight out of a .conf works), or by the friendly name tag
//     (e.g. "Ger28_09262026_143012", with '#' and the trailing flag
//     emoji ignored) — identical matching strategy to
//     keystatus_handler.js's WireGuard lookup branch.
//   - The server for a client is found via wg_clients.server_name ->
//     vpn_servers.ServerName (exact match — that's exactly how it was
//     written at creation time in db/WGKeyCreation.js's saveClientToDB).
//   - If the server responds 404 to /remove, that's treated as "already
//     gone" (informational, not an error) and the DB is still updated —
//     same philosophy as /removekeyexpired for Outline. Any OTHER error
//     aborts before touching the DB, so a real failure doesn't silently
//     mark something removed that isn't.
//   - No custom httpsAgent (no rejectUnauthorized:false) — matches
//     requestNewPeer()'s /create call in db/WGKeyCreation.js, which also
//     uses plain axios with default TLS verification.
const registry = require('./commandRegistry');
registry.register('/wgremovekey <name|key>', 'removes WireGuard peer from server AND marks it deleted in DB', ['superadmin', 'admin']);
registry.register('/wgremovekeyexpired <name|key>', 'removes WireGuard peer from server only, marks it expired in DB', ['superadmin', 'admin']);

/**
 * Usage:
 *   normalizeWgNameToken('#Ger28_09262026_143012🇩🇪') -> 'ger28_09262026_143012'
 *
 * Same normalization as keystatus_handler.js: strip a leading '#', keep
 * only the leading run of [A-Za-z0-9_] (always exactly the flag-free
 * name, since wg_clients.name has no space before its flag emoji
 * suffix), lowercase for case-insensitive matching.
 */
function normalizeWgNameToken(value) {
    const noHash = String(value).trim().replace(/^#/, '');
    const match = noHash.match(/^[A-Za-z0-9_]+/);
    return (match ? match[0] : noHash).toLowerCase();
}

/**
 * Usage:
 *   const client = await findWgClient(db, 'Ger28_09262026_143012');
 *   // -> full wg_clients row, or null
 *
 * Searches ALL wg_clients rows (any owner) by exact public_key, exact
 * private_key, or normalized name — same three-way match used in
 * keystatus_handler.js's WireGuard lookup branch.
 */
async function findWgClient(db, input) {
    const [rows] = await db.execute('SELECT * FROM wg_clients');
    const normalizedNameInput = normalizeWgNameToken(input);

    return rows.find(row =>
        input === row.public_key ||
        input === row.private_key ||
        (normalizedNameInput && normalizeWgNameToken(row.name) === normalizedNameInput)
    ) || null;
}

/**
 * Usage:
 *   const result = await removePeerFromServer(axios, server, '10.66.66.4/32');
 *   // -> { ok: true } | { ok: true, alreadyGone: true } | { ok: false, error: '...' }
 *
 * Calls the WireGuard server's POST /remove endpoint. The address's
 * CIDR suffix (the "/32" WireGuard configs always carry) is stripped,
 * since /remove wants a bare ipAddress.
 */
async function removePeerFromServer(axios, server, address) {
    let baseUrl = server.PublicURLInternational;
    if (!/^https?:\/\//i.test(baseUrl)) {
        baseUrl = `https://${baseUrl}`;
    }
    const removeUrl = `${baseUrl.replace(/\/$/, '')}/remove`;
    const ipAddress = String(address).split('/')[0];

    try {
        await axios.post(removeUrl, { ipAddress }, {
            headers: {
                Authorization: `Bearer ${server.BearerToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        return { ok: true };
    } catch (error) {
        if (error.response && error.response.status === 404) {
            return { ok: true, alreadyGone: true };
        }
        const errMsg = error.response ? `HTTP ${error.response.status} ${error.response.statusText}` : error.message;
        return { ok: false, error: errMsg };
    }
}

module.exports = function registerWgRemoveKeysCommands(bot, deps) {
    const { db, axios } = deps;

    /**
     * Shared body for both commands: admin gate, arg parsing, client
     * lookup, server lookup, and the actual /remove call. Only what
     * happens to the DB row afterward differs between the two callers
     * (hardDelete: true for /wgremovekey, false for /wgremovekeyexpired).
     *
     * Usage: called from each command's bot.onText callback below —
     * not invoked directly.
     */
    async function handleRemoval(msg, match, { hardDelete }) {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const input = match[1] ? match[1].trim() : '';
        const commandName = hardDelete ? 'wgremovekey' : 'wgremovekeyexpired';

        try {
            // --- superadmin / admin gate (moderator excluded) ---
            const [adminRows] = await db.execute(
                "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 AND Role IN ('admin','superadmin') LIMIT 1",
                [senderId]
            );
            if (!adminRows || adminRows.length === 0) {
                await bot.sendMessage(chatId, "❌ Error: You are not an active admin.");
                return;
            }

            if (!input) {
                await bot.sendMessage(chatId, `⚠️ Usage: /${commandName} <name|publicKey|privateKey>`);
                return;
            }

            const client = await findWgClient(db, input);
            if (!client) {
                await bot.sendMessage(chatId, `❌ No WireGuard client found matching: ${input}`);
                return;
            }

            const [serverRows] = await db.execute(
                'SELECT PublicURLInternational, BearerToken FROM vpn_servers WHERE ServerName = ? LIMIT 1',
                [client.server_name]
            );
            if (!serverRows || serverRows.length === 0) {
                await bot.sendMessage(chatId, `❌ Server config not found for: ${client.server_name}`);
                return;
            }

            const server = serverRows[0];
            if (!server.BearerToken) {
                await bot.sendMessage(chatId, `❌ Server "${client.server_name}" has no BearerToken configured.`);
                return;
            }

            const result = await removePeerFromServer(axios, server, client.address);
            if (!result.ok) {
                await bot.sendMessage(chatId, `❌ Failed to remove peer on server: ${result.error}`);
                return;
            }

            if (hardDelete) {
                // Hard delete — the row and its usage history are gone,
                // same as /removekey's DELETE FROM UserKeys.
                await db.execute(
                    'DELETE FROM wg_clients WHERE client_id = ?',
                    [client.client_id]
                );
            } else {
                await db.execute(
                    'UPDATE wg_clients SET is_expired = 1, expires_at = NOW() WHERE client_id = ?',
                    [client.client_id]
                );
            }

            const verb = hardDelete
                ? 'removed from server and permanently deleted from the database'
                : 'removed from server; marked expired (row kept for history)';
            const note = result.alreadyGone ? ' — was already gone from the server' : '';

            await bot.sendMessage(chatId, `✅ 🔌 WireGuard client "${client.name}" ${verb}${note}.`);

        } catch (error) {
            console.error(`/${commandName} error:`, error);
            await bot.sendMessage(chatId, `❌ Unexpected error: ${error.message}`);
        }
    }

    bot.onText(/\/wgremovekey\s+([\s\S]+)/, (msg, match) => handleRemoval(msg, match, { hardDelete: true }));
    bot.onText(/\/wgremovekeyexpired\s+([\s\S]+)/, (msg, match) => handleRemoval(msg, match, { hardDelete: false }));
};
