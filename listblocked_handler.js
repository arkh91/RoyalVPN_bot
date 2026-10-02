// listblocked_handler.js
//
// Usage:
//   const registerListBlockedCommand = require('./listblocked_handler');
//   registerListBlockedCommand(bot, { db });
//
// Registers "/listblocked" and its alias "/lb" — checks every account in
// `accounts` and reports which ones have blocked the bot: Name, UserID
// (tap-to-copy), Username, and CreatedAt (date joined).
//
// ACCESS: superadmin + admin only (moderator excluded), same gate as
// /listusers.
//
// Design notes:
//   - NOTHING is written to the database — this is a live, on-demand
//     probe with the result only ever sent back as a Telegram reply, per
//     request. Nothing about "blocked" status is persisted anywhere.
//   - There's no Telegram API that directly answers "has this user
//     blocked me". Instead, this uses bot.sendChatAction(userId, 'typing')
//     as a probe: it requires the same permission as sendMessage (so it
//     throws the identical "403 Forbidden: bot was blocked by the user"
//     error if blocked), but doesn't create a visible message in the
//     user's chat the way a real sendMessage would.
//   - Only errors whose message actually contains "blocked" are counted
//     as a block — other 403/network errors (deactivated account,
//     invalid chat, rate limiting, etc.) are skipped rather than
//     miscounted as "blocked", since they mean something different.
//   - This checks EVERY account, so on a large user base it can take a
//     while and make a lot of API calls — sends are paced (see
//     CHECK_DELAY_MS) to avoid bursting past Telegram's rate limits.
const CHECK_DELAY_MS = 35;

const registry = require('./commandRegistry');
registry.register('/listblocked or /lb', 'list accounts that have blocked the bot', ['superadmin', 'admin']);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = function registerListBlockedCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/(listblocked|lb)$/i, async (msg) => {
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

            const [users] = await db.execute(
                `SELECT UserID, FirstName, LastName, Username, CreatedAt FROM accounts`
            );

            if (users.length === 0) {
                await bot.sendMessage(chatId, 'ℹ️ No accounts found.');
                return;
            }

            await bot.sendMessage(chatId, `🔎 Checking ${users.length} account(s) for blocked status...`);

            const blocked = [];

            for (const user of users) {
                try {
                    await bot.sendChatAction(user.UserID, 'typing');
                } catch (err) {
                    const msgText = (err.message || '').toLowerCase();
                    if (msgText.includes('blocked')) {
                        blocked.push(user);
                    }
                    // Other errors (deactivated, invalid chat, etc.) are
                    // skipped — they don't mean "blocked".
                }
                await sleep(CHECK_DELAY_MS);
            }

            if (blocked.length === 0) {
                await bot.sendMessage(chatId, `✅ Scan complete. ${users.length} account(s) checked, none have blocked the bot.`);
                return;
            }

            let messages = [];
            let response = `🚫 ${blocked.length} of ${users.length} account(s) have blocked the bot:\n\n`;

            blocked.forEach((user, i) => {
                const fullName = `${user.FirstName || ''} ${user.LastName || ''}`.trim() || 'Unknown Name';
                const usernamePart = user.Username ? `@${escapeHtml(user.Username)}` : 'No Username';
                const entry = `${i + 1}. ${escapeHtml(fullName)}\n   UserID: <code>${user.UserID}</code>\n   ${usernamePart}\n   Joined: ${escapeHtml(user.CreatedAt)}\n\n`;

                // Start a NEW message before adding an entry that would
                // overflow — never slice mid-entry, so a <code> tag can
                // never get split across two messages.
                if (response.length + entry.length > 3500) {
                    messages.push(response);
                    response = "";
                }
                response += entry;
            });

            if (response.length > 0) messages.push(response);

            for (const part of messages) {
                await bot.sendMessage(chatId, part, { parse_mode: 'HTML' });
            }

        } catch (err) {
            console.error('/listblocked error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.message || err.code}`);
        }
    });
};
