// checkbalance_handler.js
//
// Usage:
//   const registerCheckBalanceCommand = require('./checkbalance_handler');
//   registerCheckBalanceCommand(bot, { db });
//
// Registers "/checkbalance" — shows the top N users by CurrentBalance
// (highest first), with each UserID rendered as tap-to-copy. Same
// argument/help pattern as /listusers (/lu).
//
// ACCESS: superadmin + admin only (moderator excluded), same gate as
// /listusers and /servercheck.
//
// Usage:
//   /checkbalance          -> shows usage instructions, lists nothing
//   /checkbalance 10       -> lists the top 10 users by balance
//
// Design notes:
//   - Tap-to-copy is achieved via HTML <code> tags + parse_mode: 'HTML',
//     same technique already used for UserID in /listusers and
//     /UsageWarning.
//   - <count> is interpolated directly into LIMIT (after validating it's
//     a positive integer via parseInt) rather than bound as a parameter,
//     matching the codebase's existing convention elsewhere — older
//     mysql2 driver versions error on "LIMIT ?" in prepared statements.
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = function registerCheckBalanceCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/checkbalance(?:\s+(\d+))?$/i, async (msg, match) => {
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
            if (match[1] === undefined) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ Usage:\n" +
                    "/checkbalance <count>   - list the top <count> users by balance\n\n" +
                    "Example: /checkbalance 10"
                );
                return;
            }

            const count = parseInt(match[1], 10);
            if (isNaN(count) || count <= 0) {
                await bot.sendMessage(chatId, '⚠️ <count> must be a positive number.');
                return;
            }

            const [users] = await db.execute(
                `SELECT UserID, FirstName, LastName, Username, CurrentBalance
                 FROM accounts
                 ORDER BY CurrentBalance DESC
                 LIMIT ${count}`
            );

            if (users.length === 0) {
                await bot.sendMessage(chatId, 'ℹ️ No users found.');
                return;
            }

            let message = `💰 Top ${users.length} user(s) by balance:\n\n`;
            users.forEach((user, i) => {
                const fullName = `${user.FirstName || ''} ${user.LastName || ''}`.trim() || 'Unknown Name';
                const usernamePart = user.Username ? `@${escapeHtml(user.Username)}` : 'No Username';
                const balance = `$${Number(user.CurrentBalance).toFixed(2)}`;
                message += `${i + 1}. ${escapeHtml(fullName)}\n   UserID: <code>${user.UserID}</code>\n   ${usernamePart}\n   Balance: ${balance}\n\n`;
            });

            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

        } catch (err) {
            console.error('/checkbalance error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.code || err.message}`);
        }
    });
};
