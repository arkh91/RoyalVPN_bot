// broadcast_handler.js
//
// Usage:
//   const registerBroadcastCommand = require('./broadcast_handler');
//   registerBroadcastCommand(bot, { db });
//
// Registers "/broadcast <message>" — sends <message> to every UserID in
// the `accounts` table (i.e. everyone who has ever run /start).
//
// ACCESS: SUPERADMIN ONLY.
//
// Usage example:
//   /broadcast Scheduled maintenance tonight 11PM-1AM UTC, expect brief downtime.
//
// Design notes:
//   - Sent as PLAIN TEXT (no parse_mode). Broadcast text is free-form
//     admin input, and Markdown/HTML parse errors on stray * _ < > chars
//     would silently abort delivery to that user — plain text can't fail
//     that way.
//   - Sends are paced with a small delay between each (see SEND_DELAY_MS)
//     to stay well under Telegram's outbound rate limits, since a
//     broadcast can be sending to hundreds/thousands of chats in a row.
//   - Failures (blocked bot, deactivated account, etc.) don't stop the
//     broadcast — each failure is recorded and reported back to the
//     admin in a single summary message at the end, listing
//     FirstName LastName, UserID, and @Username (or "No Username").

// Usage:
//   SEND_DELAY_MS controls the pause between each bot.sendMessage call.
//   30ms -> ~33 sends/sec, comfortably under Telegram's ~30 msg/sec
//   global outbound cap while still finishing a broadcast reasonably fast.
const SEND_DELAY_MS = 35;

// Usage:
//   sleep(35) -> a Promise that resolves after 35ms
//
// Tiny delay helper used to pace outbound sends between broadcast
// recipients so we don't burst past Telegram's rate limits.
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Usage:
//   describeRecipient(row) -> 'John Doe 123456789 && @johnd'
//   describeRecipient(row) -> 'John Doe 123456789 && No Username'
//
// Formats one recipient's line for the end-of-broadcast summary messages,
// so admins can identify exactly who did/didn't receive the message.
function describeRecipient(row) {
    const fullName = `${row.FirstName || ''} ${row.LastName || ''}`.trim() || 'Unknown Name';
    const usernamePart = row.Username ? `@${row.Username}` : 'No Username';
    return `${fullName} ${row.UserID} && ${usernamePart}`;
}

// Usage:
//   await sendInChunks(bot, chatId, longText)
//
// Telegram messages cap out around 4096 chars. This splits a long summary
// (e.g. hundreds of failed-recipient lines) into multiple messages instead
// of one call that would be rejected by the API.
async function sendInChunks(bot, chatId, text) {
    const CHUNK_SIZE = 3500;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        await bot.sendMessage(chatId, text.slice(i, i + CHUNK_SIZE));
    }
}

module.exports = function registerBroadcastCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/broadcast(?:\s+([\s\S]+))?$/, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const messageText = match[1] ? match[1].trim() : '';

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

            if (!messageText) {
                await bot.sendMessage(chatId, '⚠️ Usage: /broadcast <message>');
                return;
            }

            // --- Gather every recipient who has ever used the bot ---
            const [recipients] = await db.execute(
                'SELECT UserID, FirstName, LastName, Username FROM accounts'
            );

            if (recipients.length === 0) {
                await bot.sendMessage(chatId, 'ℹ️ No recipients found in accounts.');
                return;
            }

            await bot.sendMessage(chatId, `📣 Starting broadcast to ${recipients.length} user(s)...`);

            let successes = [];
            const failures = [];

            for (const recipient of recipients) {
                try {
                    await bot.sendMessage(recipient.UserID, messageText);
                    successes.push(recipient);
                } catch (err) {
                    failures.push(recipient);
                    console.error(`Broadcast failed for UserID ${recipient.UserID}:`, err.message);
                }
                // Pace sends to stay under Telegram's rate limits
                await sleep(SEND_DELAY_MS);
            }

            // --- Two separate summary messages back to the admin ---
            const successMessage =
                `✅ Broadcast complete.\n` +
                `Successfully sent ${successes.length}/${recipients.length}\n\n` +
                successes.map(describeRecipient).join('\n');

            const failureMessage =
                `❌ Failed recipients:\n` +
                `Failed ${failures.length}/${recipients.length}\n\n` +
                failures.map(describeRecipient).join('\n');

            await sendInChunks(bot, chatId, successMessage);
            await sendInChunks(bot, chatId, failureMessage);

        } catch (err) {
            console.error('/broadcast error:', err);
            await bot.sendMessage(chatId, '⚠️ Internal error occurred while broadcasting.');
        }
    });
};
