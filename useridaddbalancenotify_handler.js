// useridaddbalancenotify_handler.js
//
// Usage:
//   const registerAddBalanceNotifyCommand = require('./useridaddbalancenotify_handler');
//   registerAddBalanceNotifyCommand(bot, { db });
//
// Registers "/useridADDbalanceNotify <usd|rial> <UserID> <amount>" —
// functionally identical to /useridADDbalance (same payments/accounts
// writes, same positive-amount-only validation), with ONE difference:
// after the balance is updated, the target user is sent a DM letting
// them know how much was added and their new balance.
//
// ACCESS: superadmin + admin only (moderator excluded), same gate as
// /useridADDbalance.
//
// Usage examples:
//   /useridADDbalanceNotify                           -> shows usage instructions
//   /useridADDbalanceNotify usd 123456789 5           -> +$5.00 to the USD balance
//   /useridADDbalanceNotify rial 123456789 2000000    -> +2,000,000 Rial to the Rial balance
//   (the usd/rial word may also sit elsewhere: /useridADDbalanceNotify 123456789 rial 2000000)
//
// Design notes:
//   - Amount must be positive, same restriction as /useridADDbalance —
//     this is an "add funds and tell them" tool, not a general balance
//     editor (that's /useridUpdatebalance).
//   - The payments row + balance update happen together in
//     db/creditAccount.js (one transaction).
//   - If the user-facing DM fails to send (e.g. they've blocked the
//     bot), that does NOT roll back the balance update — the balance
//     change already succeeded and is real; the admin is just told the
//     notification itself failed, so they can follow up manually if
//     needed.
const registry = require('./commandRegistry');
const creditAccount = require('./db/creditAccount');
const { tokenize, extractCurrency, formatMoney, validateAmount } = require('./currency');

registry.register(
    '/useridADDbalanceNotify <usd|rial> <UserID> <amount>',
    'adds USD or Rial to a user and DMs them the new balance (no args = usage)',
    ['superadmin', 'admin'],
    'Account'
);

const USAGE =
    '⚠️ Usage:\n' +
    '/useridADDbalanceNotify <usd|rial> <UserID> <amount>   - adds funds and notifies the user\n\n' +
    'Examples:\n/useridADDbalanceNotify usd 123456789 2\n/useridADDbalanceNotify rial 123456789 180000';

module.exports = function registerAddBalanceNotifyCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/useridADDbalanceNotify(?:\s+([\s\S]+))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;

        try {
            const [countRows] = await db.execute(
                `SELECT COUNT(AdminID) AS cnt
                 FROM Admins
                 WHERE UserID = ?
                   AND Role IN ('admin', 'superadmin')
                   AND IsActive = 1`,
                [senderId]
            );

            if (countRows[0].cnt === 0) {
                await bot.sendMessage(chatId, '❌ Error: You are not an active admin.');
                return;
            }

            // --- Arguments: <usd|rial> <UserID> <amount>; anything else shows the usage ---
            const { currency, rest } = extractCurrency(tokenize(match[1]));
            if (!currency || rest.length !== 2 || !/^\d+$/.test(rest[0]) || !/^\d+(?:\.\d+)?$/.test(rest[1])) {
                await bot.sendMessage(chatId, USAGE);
                return;
            }

            const userId = parseInt(rest[0], 10);
            const amount = parseFloat(rest[1]);

            const amountError = validateAmount(currency, amount);
            if (amountError) {
                await bot.sendMessage(chatId, `⚠️ ${amountError}\n\n${USAGE}`);
                return;
            }

            const [users] = await db.query(
                `SELECT UserID, Username FROM accounts WHERE UserID = ? LIMIT 1`,
                [userId]
            );

            if (!users || users.length === 0) {
                await bot.sendMessage(chatId, `⚠️ No account found for UserID: ${userId}`);
                return;
            }

            const user = users[0];
            const who = user.Username ? '@' + user.Username : 'UserID ' + userId;

            const newBalance = await creditAccount(db, userId, amount, currency);

            await bot.sendMessage(
                chatId,
                `✅ Successfully added ${formatMoney(currency, amount)} to ${who}'s balance.\n💰 New Balance: ${formatMoney(currency, newBalance)}`
            );

            // --- Notify the user (the one difference from /useridADDbalance) ---
            try {
                await bot.sendMessage(
                    userId,
                    `💰 ${formatMoney(currency, amount)} has been added to your account.\nYour new balance: ${formatMoney(currency, newBalance)}`
                );
                await bot.sendMessage(chatId, `✅ Notification sent to ${who}.`);
            } catch (notifyErr) {
                console.error(`Failed to notify UserID ${userId}:`, notifyErr.message);
                await bot.sendMessage(chatId, `⚠️ Balance was updated, but the notification to the user failed: ${notifyErr.message}`);
            }

        } catch (err) {
            console.error("DB Error:", err);
            await bot.sendMessage(chatId, "❌ Database error.");
        }
    });
};
