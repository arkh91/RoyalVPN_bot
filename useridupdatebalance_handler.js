// useridupdatebalance_handler.js
//
// Usage:
//   const registerUpdateBalanceCommand = require('./useridupdatebalance_handler');
//   registerUpdateBalanceCommand(bot, { db });
//
// Registers "/useridUpdatebalance <UserID> <newBalance>" — SETS a user's
// CurrentBalance to exactly <newBalance> (an absolute value, not a delta
// applied on top of the current balance). Unlike /usernameADDbalance and
// /useridADDbalance, this does NOT insert a row into `payments` — it's a
// direct balance correction tool, not a payment-creation flow, so it
// only touches `accounts.CurrentBalance`.
//
// ACCESS: superadmin + admin only (moderator excluded).
//
// Usage example:
//   /useridUpdatebalance 123456789 5      -> sets balance to exactly $5.00
//
// Design notes:
//   - CurrentBalance must never go below 0. Since this SETS the balance
//     directly, that simply means <newBalance> itself must be >= 0 —
//     there's no "would this push it negative" calculation needed since
//     we're not adding to anything.
module.exports = function registerUpdateBalanceCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/useridUpdatebalance\s+(\d+)\s+(-?\d+(?:\.\d+)?)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const userId = match[1];
        const newBalance = parseFloat(match[2]);

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

            if (isNaN(newBalance)) {
                await bot.sendMessage(chatId, '⚠️ Usage: /useridUpdatebalance <UserID> <newBalance>\nExample: /useridUpdatebalance 123456789 5');
                return;
            }

            if (newBalance < 0) {
                await bot.sendMessage(chatId, `❌ Balance cannot be set below $0.00 (got $${newBalance.toFixed(2)}).`);
                return;
            }

            const [users] = await db.execute(
                'SELECT UserID, Username, CurrentBalance FROM accounts WHERE UserID = ? LIMIT 1',
                [userId]
            );

            if (!users || users.length === 0) {
                await bot.sendMessage(chatId, `⚠️ No account found for UserID: ${userId}`);
                return;
            }

            const user = users[0];
            const previousBalance = Number(user.CurrentBalance);

            await db.execute(
                'UPDATE accounts SET CurrentBalance = ? WHERE UserID = ?',
                [newBalance.toFixed(2), userId]
            );

            const displayName = user.Username ? `@${user.Username}` : `UserID ${userId}`;

            await bot.sendMessage(
                chatId,
                `✅ Balance updated for ${displayName}.\n` +
                `Previous: $${previousBalance.toFixed(2)}\n` +
                `New Balance: $${newBalance.toFixed(2)}`
            );

        } catch (err) {
            console.error('/useridUpdatebalance error:', err);
            await bot.sendMessage(chatId, `❌ Database error: ${err.code || err.message}`);
        }
    });
};
