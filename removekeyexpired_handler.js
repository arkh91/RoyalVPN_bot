// removekeyexpired_handler.js
//
// Usage:
//   const registerRemoveKeyExpiredCommand = require('./removekeyexpired_handler');
//   registerRemoveKeyExpiredCommand(bot, { db, SERVERS, axios, https });
//
// Registers "/removekeyexpired <guikey|fullkey>" — identical lookup logic
// to the existing /removekey command, but ONLY removes the key from its
// Outline server. The UserKeys row is left untouched in the DB either way.
//
// ACCESS: superadmin + admin only (moderator excluded).
//
// Usage example:
//   /removekeyexpired #Ger27_07142026_150423
//   /removekeyexpired ss://...@host:22627#Ger27_07142026_150423
//
// Design notes:
//   - This is intentionally a near-duplicate of /removekey's server-side
//     logic (find the DB row -> find the matching access key on the
//     server -> DELETE it there) with every db.execute("DELETE FROM
//     UserKeys ...") call removed. Kept as its own command/file rather
//     than adding a flag to /removekey, since the two have different
//     enough intents (permanently forget a key vs. just clear it off the
//     server while keeping DB history, e.g. for an already-expired key
//     you still want billing/usage records for).
//   - If the key is already gone from the server, that's reported as
//     informational, not an error — there's nothing to remove.
module.exports = function registerRemoveKeyExpiredCommand(bot, deps) {
    const { db, SERVERS, axios, https } = deps;

    bot.onText(/\/removekeyexpired\s+([\s\S]+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const input = match[1].trim();

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

            const altGui = input.startsWith('#') ? input.substring(1).trim() : ('#' + input);

            let [rows] = await db.execute(
                "SELECT FullKey, GuiKey, ServerName FROM UserKeys WHERE GuiKey = ? OR GuiKey = ? LIMIT 1",
                [input, altGui]
            );

            if (!rows || rows.length === 0) {
                [rows] = await db.execute(
                    "SELECT FullKey, GuiKey, ServerName FROM UserKeys WHERE FullKey = ? LIMIT 1",
                    [input]
                );
            }

            if (!rows || rows.length === 0) {
                await bot.sendMessage(chatId, `❌ No key found with GuiKey or FullKey: ${input}`);
                return;
            }

            const row = rows[0];
            const storedGuiKey = row.GuiKey;
            const serverName = row.ServerName;

            const server = SERVERS[serverName];
            if (!server) {
                await bot.sendMessage(chatId, `❌ Server config not found for: ${serverName}`);
                return;
            }

            let baseUrl = server.apiUrl || server.baseUrl || server.api;
            if (!baseUrl.endsWith('/')) baseUrl += '/';
            const listUrl = `${baseUrl}${server.apiKey}/access-keys`;
            const httpsAgent = new https.Agent({ rejectUnauthorized: false });

            let accessKeys = [];
            try {
                const resp = await axios.get(listUrl, { httpsAgent, timeout: 15000 });
                accessKeys = resp.data && resp.data.accessKeys
                    ? resp.data.accessKeys
                    : (Array.isArray(resp.data) ? resp.data : []);
            } catch (err) {
                const errMsg = err.response ? `HTTP ${err.response.status} ${err.response.statusText}` : err.message;
                await bot.sendMessage(chatId, `❌ Failed to fetch key list from server: ${errMsg}`);
                return;
            }

            const nameToFind = storedGuiKey.startsWith('#') ? storedGuiKey.substring(1).trim() : storedGuiKey.trim();
            const matchKey = accessKeys.find(k => {
                if (!k || typeof k.name !== 'string') return false;
                const n = k.name.trim();
                return n === nameToFind || n === storedGuiKey.trim() || n === ('#' + nameToFind);
            });

            if (!matchKey) {
                // Nothing to remove — DB row is left as-is, unlike /removekey.
                await bot.sendMessage(chatId, `ℹ️ Key "${storedGuiKey}" was already not present on server ${serverName}. DB record left unchanged.`);
                return;
            }

            const keyId = matchKey.id || matchKey.keyId || matchKey.accessKeyId;
            if (!keyId) {
                await bot.sendMessage(chatId, `❌ Found key on server but couldn't determine its id.`);
                return;
            }

            const delUrl = `${baseUrl}${server.apiKey}/access-keys/${encodeURIComponent(keyId)}`;
            try {
                await axios.delete(delUrl, { httpsAgent, timeout: 15000 });
            } catch (err) {
                const errMsg = err.response ? `HTTP ${err.response.status} ${err.response.statusText}` : err.message;
                if (err.response && err.response.status === 404) {
                    await bot.sendMessage(chatId, `ℹ️ Server 404 (already gone). "${storedGuiKey}" was not on the server. DB record left unchanged.`);
                    return;
                }
                await bot.sendMessage(chatId, `❌ Failed to remove key on server: ${errMsg}`);
                return;
            }

            await bot.sendMessage(chatId, `✅ Key "${storedGuiKey}" removed from server ${serverName}. DB record left unchanged.`);

        } catch (error) {
            console.error("/removekeyexpired error:", error);
            await bot.sendMessage(chatId, `❌ Unexpected error: ${error.message}`);
        }
    });
};
