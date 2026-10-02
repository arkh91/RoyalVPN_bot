// checkbalance_handler.js
//
// Usage:
//   const registerCheckBalanceCommand = require('./checkbalance_handler');
//   registerCheckBalanceCommand(bot, { db });
//
// Registers "/checkbalance <usd|rial> <count>" — shows the top N users by
// the chosen balance (highest first), with each UserID rendered as
// tap-to-copy. Same argument/help pattern as /listusers (/lu).
//
// ACCESS: superadmin + admin only (moderator excluded), same gate as
// /listusers and /servercheck.
//
// Usage examples:
//   /checkbalance                -> shows usage instructions, lists nothing
//   /checkbalance usd 10         -> top 10 users by USD balance (CurrentBalance)
//   /checkbalance rial 10        -> top 10 users by Rial balance (IRC)
//   (the usd/rial word may also come after the count: /checkbalance 10 rial)
//
// Design notes:
//   - Tap-to-copy is achieved via HTML <code> tags + parse_mode: 'HTML',
//     same technique already used for UserID in /listusers and
//     /UsageWarning.
//   - <count> is interpolated directly into LIMIT (after validating it is
//     a positive integer) rather than bound as a parameter, matching the
//     codebase's existing convention elsewhere — older mysql2 driver
//     versions error on "LIMIT ?" in prepared statements.
//   - The ORDER BY column comes from currency.js (a fixed whitelist), never
//     from user input, so interpolating it into the SQL is safe.
const registry = require('./commandRegistry');
const { tokenize, extractCurrency, columnFor, formatMoney, CURRENCIES } = require('./currency');

registry.register(
    '/checkbalance <usd|rial> <count>',
    'top N users by USD or Rial balance (no args = usage)',
    ['superadmin', 'admin'],
    'Account'
);

const USAGE =
    '⚠️ Usage:\n' +
    '/checkbalance <usd|rial> <count>   - top <count> users by that balance\n\n' +
    'Examples:\n/checkbalance usd 10\n/checkbalance rial 10';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = function registerCheckBalanceCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/checkbalance(?:\s+([\s\S]+))?$/i, async (msg, match) => {
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

            // --- Arguments: <usd|rial> and <count>; anything else shows the usage ---
            const { currency, rest } = extractCurrency(tokenize(match[1]));
            if (!currency || rest.length !== 1 || !/^\d+$/.test(rest[0]) || parseInt(rest[0], 10) <= 0) {
                await bot.sendMessage(chatId, USAGE);
                return;
            }

            const count = parseInt(rest[0], 10);
            const col = columnFor(currency); // fixed whitelist -> safe to interpolate

            const [users] = await db.execute(
                `SELECT UserID, FirstName, LastName, Username, ${col} AS Balance
                 FROM accounts
                 ORDER BY ${col} DESC
                 LIMIT ${count}`
            );

            if (users.length === 0) {
                await bot.sendMessage(chatId, 'ℹ️ No users found.');
                return;
            }

            let message = `💰 Top ${users.length} user(s) by ${CURRENCIES[currency].label} balance:\n\n`;
            users.forEach((user, i) => {
                const fullName = `${user.FirstName || ''} ${user.LastName || ''}`.trim() || 'Unknown Name';
                const usernamePart = user.Username ? `@${escapeHtml(user.Username)}` : 'No Username';
                const balance = formatMoney(currency, user.Balance);
                message += `${i + 1}. ${escapeHtml(fullName)}\n   UserID: <code>${user.UserID}</code>\n   ${usernamePart}\n   Balance: ${balance}\n\n`;
            });

            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

        } catch (err) {
            console.error('/checkbalance error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.code || err.message}`);
        }
    });
};
