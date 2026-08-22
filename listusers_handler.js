// listusers_handler.js
//
// Usage:
//   const registerListUsersCommand = require('./listusers_handler');
//   registerListUsersCommand(bot, { db });
//
// Registers "/listusers" and its alias "/lu" — shows the last N users
// added to `accounts` (most recently created first), with each UserID
// rendered as tap-to-copy.
//
// ACCESS: superadmin + admin only (moderator excluded), same gate as
// /servercheck and /UsageWarning.
//
// Usage:
//   /listusers          -> shows usage instructions, lists nothing
//   /lu                 -> same, shows usage instructions
//   /listusers 10       -> lists the last 10 users added
//   /lu 10              -> same, alias
//
// Design notes:
//   - Tap-to-copy is achieved via HTML <code> tags + parse_mode: 'HTML' —
//     Telegram makes any <code>-wrapped text tap-to-copy on both mobile
//     and desktop clients. Same technique already used for FullKey in
//     /ks and /servercheck, and the UserID in /UsageWarning.
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = function registerListUsersCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/(listusers|lu)(?:\s+(\d+))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;

        try {
            // --- superadmin / admin gate (moderator excluded) ---
            const [adminRows] = await db.execute(
                "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1",
                [senderId]
            );
            if (adminRows.length === 0 || !['superadmin', 'admin'].includes(adminRows[0].Role)) {
                await bot.sendMessage(chatId, '❌ Error: This command is restricted to superadmins and admins.');
                return;
            }

            // --- No argument: show usage instructions, list nothing ---
            if (match[2] === undefined) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ Usage:\n" +
                    "/listusers <count>   - list the last <count> users added\n" +
                    "/lu <count>          - same, alias\n\n" +
                    "Example: /lu 10"
                );
                return;
            }

            const count = parseInt(match[2], 10);
            if (isNaN(count) || count <= 0) {
                await bot.sendMessage(chatId, '⚠️ <count> must be a positive number.');
                return;
            }

            const [users] = await db.execute(
                `SELECT UserID, FirstName, LastName, Username, CreatedAt
                 FROM accounts
                 ORDER BY CreatedAt DESC
                 LIMIT ${count}`
            );

            if (users.length === 0) {
                await bot.sendMessage(chatId, 'ℹ️ No users found.');
                return;
            }

            let message = `👥 Last ${users.length} user(s) added:\n\n`;
            users.forEach((user, i) => {
                const fullName = `${user.FirstName || ''} ${user.LastName || ''}`.trim() || 'Unknown Name';
                const usernamePart = user.Username ? `@${escapeHtml(user.Username)}` : 'No Username';
                message += `${i + 1}. ${escapeHtml(fullName)}\n   UserID: <code>${user.UserID}</code>\n   ${usernamePart}\n   Joined: ${escapeHtml(user.CreatedAt)}\n\n`;
            });

            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

        } catch (err) {
            console.error('/listusers error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.code || err.message}`);
        }
    });
};
