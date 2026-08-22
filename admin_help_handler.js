// admin_help_handler.js
//
// Usage:
//   const registerAdminHelpCommand = require('./admin_help_handler');
//   registerAdminHelpCommand(bot, { db });
//
// Registers "/admin" — a reference/help command listing every admin
// command in the bot and its basic usage, grouped by the minimum role
// required to run it.
//
// ACCESS: superadmin + admin + moderator (any active admin can VIEW this
// list, even for commands they personally can't run — e.g. a moderator
// can see /broadcast exists and is superadmin-only, without being able
// to run it themselves).
//
// Design notes:
//   - This is a static reference list, not derived dynamically from the
//     other command files, so it needs to be kept in sync by hand
//     whenever a command is added/removed/renamed. Worth revisiting if
//     the command set grows much further — at that point a shared
//     command-registry module (each handler self-registers its own
//     name/usage/role) would avoid drift between this file and reality.
module.exports = function registerAdminHelpCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/admin$/i, async (msg) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;

        try {
            // --- superadmin / admin / moderator gate ---
            const [adminRows] = await db.execute(
                "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1",
                [senderId]
            );
            if (adminRows.length === 0 || !['superadmin', 'admin', 'moderator'].includes(adminRows[0].Role)) {
                await bot.sendMessage(chatId, '❌ Error: You are not an active admin.');
                return;
            }

            const message =
`👑 <b>Admin Commands</b>

<b>Superadmin only</b>
/admincommand add|remove|list|status - manage the Admins table
/broadcast &lt;message&gt; - send a message to every user

<b>Superadmin + Admin + Moderator</b>
/keystatus &lt;key&gt; - look up any key's owner, status, usage
/admin - this command

<b>Superadmin + Admin</b>
/userbalance &lt;username&gt;
/userbalanceuserID &lt;UserID&gt;
/usernameADDbalance &lt;username&gt; &lt;amount&gt;
/useridADDbalance &lt;UserID&gt; &lt;amount&gt;
/useridUpdatebalance &lt;UserID&gt; &lt;newBalance&gt; - SETS balance
/checkbalance &lt;count&gt; - top N users by balance
/sendMessage &lt;UserID&gt; "&lt;msg&gt;"
/keyusername &lt;username&gt;
/keyuserid &lt;UserID|username&gt;
/expiredkeys
/expiredkeysnotify
/removekey &lt;key&gt; - removes from server AND DB
/removekeyexpired &lt;key&gt; - removes from server only
/updatekey &lt;old&gt; &lt;new&gt;
/servercheck or /sc
/UsageWarning [min] [max] - scans usage %, notifies users
/usagewarninginfo [min] [max] - same scan, admin view only
/listusers or /lu &lt;count&gt;
/hc or /HiddenCommands`;

            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

        } catch (err) {
            console.error('/admin error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${err.code || err.message}`);
        }
    });
};
