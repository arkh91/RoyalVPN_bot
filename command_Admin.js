// command_Admin.js
//
// Usage:
//   const registerAdminCommand = require('./command_Admin');
//   registerAdminCommand(bot, { db });
//
// Registers "/admincommad add|remove <@username|UserID> [role]" — manages
// the Admins table (add a new admin/moderator, change an existing one's
// role, or deactivate one).
//
// ACCESS: SUPERADMIN ONLY. Every other role — including existing admins
// and moderators — is rejected, since this command controls who else
// gets admin power in the first place. Kept in its own file (not
// commands.js) and registered directly from main.js, per request.
//
// Usage examples:
//   /admincommad add @someuser admin
//   /admincommad add 123456789 moderator
//   /admincommad add @someuser superadmin
//   /admincommad remove @someuser
//   /admincommad remove 123456789
//   /admincommad list
//   /admincommad status @someuser
//   /admincommad status 123456789
//
// Design notes:
//   - "remove" is a SOFT delete (Admins.IsActive = 0), not a DELETE FROM,
//     so AddedAt/Role history is preserved and the same person can be
//     reactivated later by running "add" again with a fresh role.
//   - "add" is an upsert: if the UserID already has an Admins row, its
//     Role is updated and IsActive is set back to 1; otherwise a new
//     row is inserted. This relies on Admins.UserID being UNIQUE.
//   - Target can be given as @username (looked up in `accounts`) or as
//     a raw numeric Telegram UserID.

const VALID_ROLES = ['superadmin', 'admin', 'moderator'];

// Usage:
//   resolveTarget('@someuser', db) -> { userId, username } or null
//   resolveTarget('123456789', db) -> { userId, username } or null
//
// Turns whatever the caller typed (an @username or a raw numeric UserID)
// into a concrete UserID, looking up `accounts` for a display Username.
// Returns null only when a username was given but no matching account
// exists — a raw numeric UserID is always accepted even if it has no
// `accounts` row yet (e.g. someone who hasn't run /start).
async function resolveTarget(rawTarget, db) {
    const cleaned = rawTarget.replace(/^@/, '').trim();

    if (/^\d+$/.test(cleaned)) {
        const [rows] = await db.execute(
            'SELECT UserID, Username FROM accounts WHERE UserID = ? LIMIT 1',
            [cleaned]
        );
        if (rows.length > 0) {
            return { userId: rows[0].UserID, username: rows[0].Username || null };
        }
        return { userId: cleaned, username: null };
    }

    const [rows] = await db.execute(
        'SELECT UserID, Username FROM accounts WHERE LOWER(Username) = LOWER(?) LIMIT 1',
        [cleaned]
    );
    if (rows.length === 0) return null;
    return { userId: rows[0].UserID, username: rows[0].Username };
}

// Usage:
//   displayName({ userId: 123, username: 'bob' }) -> '@bob'
//   displayName({ userId: 123, username: null })   -> 'UserID 123'
//
// Small helper so reply messages don't repeat this ternary everywhere.
function displayName(target) {
    return target.username ? '@' + target.username : 'UserID ' + target.userId;
}

// Usage:
//   escapeHtml('<script>') -> '&lt;script&gt;'
//
// Escaping for the HTML-parsed /admincommad list reply, in case a stored
// Username ever contains characters HTML would interpret as markup.
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = function registerAdminCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/admincommand(?:\s+([\s\S]+))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const argsStr = match[1] ? match[1].trim() : '';

        try {
            // --- Superadmin gate ---
            const [senderRows] = await db.execute(
                "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1",
                [senderId]
            );
            if (senderRows.length === 0 || senderRows[0].Role !== 'superadmin') {
                await bot.sendMessage(chatId, '❌ Error: This command is restricted to superadmins.');
                return;
            }

            // --- Parse args: "<add|remove|list> <target> [role]" ---
            const tokens = argsStr.split(/\s+/).filter(Boolean);
            const action = (tokens[0] || '').toLowerCase();
            const rawTarget = tokens[1];
            const rawRole = (tokens[2] || '').toLowerCase();

            if (!['add', 'remove', 'list', 'status'].includes(action)) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ Usage:\n" +
                    "/admincommad add <@username|UserID> <superadmin|admin|moderator>\n" +
                    "/admincommad remove <@username|UserID>\n" +
                    "/admincommad list\n" +
                    "/admincommad status <@username|UserID>"
                );
                return;
            }

            // --- LIST: show every row in Admins with active/inactive status ---
            if (action === 'list') {
                const [allAdmins] = await db.execute(
                    `SELECT UserID, Username, Role, IsActive
                     FROM Admins
                     ORDER BY FIELD(Role, 'superadmin', 'admin', 'moderator'), Username`
                );

                if (allAdmins.length === 0) {
                    await bot.sendMessage(chatId, 'ℹ️ No admins found.');
                    return;
                }

                let message = `👑 Admins:\n\n`;
                allAdmins.forEach((row) => {
                    const name = row.Username ? '@' + row.Username : `UserID ${row.UserID}`;
                    const statusText = row.IsActive ? 'Active' : 'Not Active';
                    message += `👤 ${name} (\`${row.UserID}\`)\nRole: ${row.Role}\nStatus: ${statusText}\n\n`;
                });

                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                return;
            }

            if (!rawTarget) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ Usage:\n" +
                    "/admincommad add <@username|UserID> <superadmin|admin|moderator>\n" +
                    "/admincommad remove <@username|UserID>\n" +
                    "/admincommad list\n" +
                    "/admincommad status <@username|UserID>"
                );
                return;
            }

            const target = await resolveTarget(rawTarget, db);
            if (!target) {
                await bot.sendMessage(chatId, `❌ No account found for: ${rawTarget}`);
                return;
            }

            // --- STATUS: show whether this UserID is an admin, and their role ---
            if (action === 'status') {
                const [adminRow] = await db.execute(
                    'SELECT Role, IsActive, AddedAt FROM Admins WHERE UserID = ? LIMIT 1',
                    [target.userId]
                );

                if (adminRow.length === 0) {
                    await bot.sendMessage(chatId, `ℹ️ ${displayName(target)} is not an admin.`);
                    return;
                }

                const { Role, IsActive } = adminRow[0];
                const statusText = IsActive ? 'Active' : 'Not Active';
                let message = `👑 Admins:\n\n`;
                 message +=
                    `👤 ${displayName(target)} (\`${target.userId}\`)\n` +
                    `Role: ${Role}\n` +
                    `Status: ${statusText}`;

                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                return;
            }

            // --- ADD (upsert) ---
            if (action === 'add') {
                if (!VALID_ROLES.includes(rawRole)) {
                    await bot.sendMessage(
                        chatId,
                        `⚠️ Invalid or missing role. Must be one of: ${VALID_ROLES.join(', ')}`
                    );
                    return;
                }

                await db.execute(
                    `INSERT INTO Admins (UserID, Username, Role, IsActive)
                     VALUES (?, ?, ?, 1)
                     ON DUPLICATE KEY UPDATE Role = VALUES(Role), Username = VALUES(Username), IsActive = 1`,
                    [target.userId, target.username, rawRole]
                );

                await bot.sendMessage(chatId, `✅ ${displayName(target)} is now ${rawRole}.`);
                return;
            }

            // --- REMOVE (soft delete: deactivate, keep history) ---
            const [result] = await db.execute(
                "UPDATE Admins SET IsActive = 0 WHERE UserID = ?",
                [target.userId]
            );

            if (result.affectedRows === 0) {
                await bot.sendMessage(chatId, `⚠️ ${displayName(target)} was not an admin.`);
                return;
            }

            await bot.sendMessage(chatId, `✅ Admin access removed for ${displayName(target)}.`);

        } catch (err) {
            console.error('/admincommad error:', err);
            await bot.sendMessage(chatId, '⚠️ Internal error occurred.');
        }
    });
};
