// useridupdatebalance_handler.js
//
// Usage:
//   const registerUpdateBalanceCommand = require('./useridupdatebalance_handler');
//   registerUpdateBalanceCommand(bot, { db });
//
// Registers "/useridUpdatebalance <usd|rial> <UserID> <newBalance>" — SETS
// one wallet of a user to exactly <newBalance> (an absolute value, not a
// delta applied on top of the current balance). Unlike /usernameADDbalance
// and /useridADDbalance, this does NOT insert a row into `payments` —
// it's a direct balance correction tool, not a payment-creation flow, so
// it only touches `accounts`.
//
// ACCESS: superadmin + admin only (moderator excluded).
//
// Usage examples:
//   /useridUpdatebalance                              -> shows usage instructions
//   /useridUpdatebalance usd 123456789 5              -> sets USD balance to exactly $5.00
//   /useridUpdatebalance rial 123456789 2000000       -> sets Rial balance to exactly 2,000,000
//   (the usd/rial word may also sit elsewhere: /useridUpdatebalance 123456789 rial 2000000)
//
// Design notes:
//   - A balance must never go below 0. Since this SETS the balance
//     directly, that simply means <newBalance> itself must be >= 0 —
//     there's no "would this push it negative" calculation needed since
//     we're not adding to anything.
//   - Rial values must be whole numbers (the column has no decimals).
//   - The column name comes from currency.js (fixed whitelist), never from
//     user input.
const registry = require('./commandRegistry');
const { tokenize, extractCurrency, columnFor, formatMoney } = require('./currency');

registry.register(
    '/useridUpdatebalance <usd|rial> <UserID> <newBalance>',
    'SETS (not adds) a user\'s USD or Rial balance (no args = usage)',
    ['superadmin', 'admin'],
    'Account'
);

const USAGE =
    '⚠️ Usage:\n' +
    '/useridUpdatebalance <usd|rial> <UserID> <newBalance>   - SETS the balance to exactly <newBalance>\n\n' +
    'Examples:\n/useridUpdatebalance usd 123456789 5\n/useridUpdatebalance rial 123456789 2000000';

module.exports = function registerUpdateBalanceCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/useridUpdatebalance(?:\s+([\s\S]+))?$/i, async (msg, match) => {
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

            // --- Arguments: <usd|rial> <UserID> <newBalance>; anything else shows the usage ---
            const { currency, rest } = extractCurrency(tokenize(match[1]));
            if (!currency || rest.length !== 2 || !/^\d+$/.test(rest[0]) || !/^-?\d+(?:\.\d+)?$/.test(rest[1])) {
                await bot.sendMessage(chatId, USAGE);
                return;
            }

            const userId = rest[0];
            const newBalance = parseFloat(rest[1]);

            if (newBalance < 0) {
                await bot.sendMessage(chatId, `❌ Balance cannot be set below ${formatMoney(currency, 0)} (got ${formatMoney(currency, newBalance)}).`);
                return;
            }

            if (currency === 'IRC' && !Number.isInteger(newBalance)) {
                await bot.sendMessage(chatId, '⚠️ Rial amounts must be whole numbers.');
                return;
            }

            const col = columnFor(currency); // fixed whitelist -> safe to interpolate

            const [users] = await db.execute(
                `SELECT UserID, Username, ${col} AS Balance FROM accounts WHERE UserID = ? LIMIT 1`,
                [userId]
            );

            if (!users || users.length === 0) {
                await bot.sendMessage(chatId, `⚠️ No account found for UserID: ${userId}`);
                return;
            }

            const user = users[0];
            const previousBalance = Number(user.Balance);

            const valueToStore = currency === 'IRC' ? String(newBalance) : newBalance.toFixed(2);
            await db.execute(
                `UPDATE accounts SET ${col} = ? WHERE UserID = ?`,
                [valueToStore, userId]
            );

            const displayName = user.Username ? `@${user.Username}` : `UserID ${userId}`;

            await bot.sendMessage(
                chatId,
                `✅ Balance updated for ${displayName}.\n` +
                `Previous: ${formatMoney(currency, previousBalance)}\n` +
                `New Balance: ${formatMoney(currency, newBalance)}`
            );

        } catch (err) {
            console.error('/useridUpdatebalance error:', err);
            await bot.sendMessage(chatId, `❌ Database error: ${err.code || err.message}`);
        }
    });
};
