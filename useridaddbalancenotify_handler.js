// useridaddbalancenotify_handler.js
//
// Usage:
//   const registerAddBalanceNotifyCommand = require('./useridaddbalancenotify_handler');
//   registerAddBalanceNotifyCommand(bot, { db });
//
// Registers "/useridADDbalanceNotify <UserID> <amount>" — functionally
// identical to the existing /useridADDbalance (same payments/accounts
// writes, same positive-amount-only validation), with ONE difference:
// after the balance is updated, the target user is sent a DM letting
// them know how much was added and their new balance.
//
// ACCESS: superadmin + admin only (moderator excluded), same gate as
// /useridADDbalance.
//
// Usage example:
//   /useridADDbalanceNotify 123456789 5
//
// Design notes:
//   - Amount must be positive, same restriction as /useridADDbalance —
//     this is an "add funds and tell them" tool, not a general balance
//     editor (that's /useridUpdatebalance).
//   - If the user-facing DM fails to send (e.g. they've blocked the
//     bot), that does NOT roll back the balance update — the balance
//     change already succeeded and is real; the admin is just told the
//     notification itself failed, so they can follow up manually if
//     needed.
module.exports = function registerAddBalanceNotifyCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/\/useridADDbalanceNotify (\d+) (\d+(\.\d+)?)/, async (msg, match) => {
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

            const userId = parseInt(match[1]);
            const amount = parseFloat(match[2]);

            if (isNaN(userId) || isNaN(amount) || amount <= 0) {
                bot.sendMessage(chatId, "⚠️ Invalid usage. Example: /useridADDbalanceNotify 12345 5");
                return;
            }

            const [users] = await db.query(
                `SELECT UserID, Username, CurrentBalance FROM accounts WHERE UserID = ? LIMIT 1`,
                [userId]
            );

            if (!users || users.length === 0) {
                bot.sendMessage(chatId, `⚠️ No account found for UserID: ${userId}`);
                return;
            }

            const user = users[0];

            const now = new Date();
            const pad = n => (n < 10 ? '0' + n : n);
            const ddmmyyyy = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}`;
            const hhmmss = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            const orderId = `${ddmmyyyy}-${hhmmss}`;
            const paymentId = orderId;
            const invoiceId = orderId;

            const insertQuery = `
                INSERT INTO payments
                (UserID, PaymentDate, PaymentMethod, DigitalCurrencyAmount, Currency, AmountPaidInUSD, CurrentRateToUSD, Status, Comments, OrderID, PaymentID, invoiceID)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const insertParams = [
                userId,
                now,
                'Rial',
                0,
                'Rial',
                amount,
                0,
                'Pending',
                'Pending via TelegramBot',
                orderId,
                paymentId,
                invoiceId
            ];
            await db.query(insertQuery, insertParams);

            const updateQuery = `
                UPDATE accounts
                SET CurrentBalance = CurrentBalance + ?
                WHERE UserID = ?
            `;
            await db.query(updateQuery, [amount, userId]);

            const [updatedUser] = await db.query(
                `SELECT CurrentBalance FROM accounts WHERE UserID = ? LIMIT 1`,
                [userId]
            );

            const newBalance = updatedUser[0].CurrentBalance;

            bot.sendMessage(
                chatId,
                `✅ Successfully added $${amount.toFixed(2)} to ${user.Username ? '@' + user.Username : 'UserID ' + userId}'s balance.\n💰 New Balance: $${Number(newBalance).toFixed(2)}`
            );

            // --- Notify the user (the one difference from /useridADDbalance) ---
            try {
                await bot.sendMessage(
                    userId,
                    `💰 $${amount.toFixed(2)} has been added to your account.\nYour new balance: $${Number(newBalance).toFixed(2)}`
                );
                bot.sendMessage(chatId, `✅ Notification sent to ${user.Username ? '@' + user.Username : 'UserID ' + userId}.`);
            } catch (notifyErr) {
                console.error(`Failed to notify UserID ${userId}:`, notifyErr.message);
                bot.sendMessage(chatId, `⚠️ Balance was updated, but the notification to the user failed: ${notifyErr.message}`);
            }

        } catch (err) {
            console.error("DB Error:", err);
            bot.sendMessage(chatId, "❌ Database error.");
        }
    });
};
