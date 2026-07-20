// commands.js
// All slash-command handlers (bot.onText) plus the generic message-forwarding
// handler, extracted from main.js.
//
// Usage in main.js:
//   const registerCommands = require('./commands');
//   registerCommands(bot, {
//       db, insertUser, insertVisit, getKeyStatusResponseMessage,
//       KeyExists, SERVERS, axios, https, mainMenu, waitingForKey
//   });
const { getKeysUsage, formatBytes } = require('./getKeysUsage');
const registerKeyStatusCommand = require('./keystatus_handler');
const registerKsCommand = require('./ks_handler');


module.exports = function registerCommands(bot, deps) {
    const {
        db,
        insertUser,
        insertVisit,
        getKeyStatusResponseMessage,
        KeyExists,
        SERVERS,
        axios,
        https,
        mainMenu,
        waitingForKey,
        getNowPaymentsInvoiceStatus
    } = deps;

    const ADMIN_ID = 542797568;
    registerKsCommand(bot, deps);
    registerKeyStatusCommand(bot, deps);
//    registerAdminCommand(bot, { db });
    // ---------------------------------------------------------------------
    // /start
    // ---------------------------------------------------------------------
    bot.onText(/\/start/, async (msg) => {
        try {
            await insertUser(msg.from);
            await insertVisit(msg.from.id);
        } catch (err) {
            console.error('Error inserting user:', err);
        }

        bot.sendMessage(
            msg.chat.id,
            "Protect your privacy with a high-speed VPN built for security, reliability, and ease of use. Our premium servers ensure fast, encrypted connections worldwide—no logs, no limits. Whether you're streaming, working, or browsing, stay safe and anonymous with just one click.\n\nPlease choose your country of residence:",
            mainMenu
        );
    });

    // ---------------------------------------------------------------------
    // /payment
    // ---------------------------------------------------------------------
    bot.onText(/\/payment/, (msg) => {
        const chatId = msg.chat.id;

        bot.sendMessage(chatId, '💳 Please choose a payment method:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Direct (Credit Card)', callback_data: 'pay_direct' }],
                    [{ text: 'Crypto Currency', callback_data: 'pay_nowpayment' }],
                    [{ text: '⬅️ Go Back', callback_data: 'back_to_main' }]
                ]
            }
        });
    });

    // ---------------------------------------------------------------------
    // /userid
    // ---------------------------------------------------------------------
    bot.onText(/^\/userid$/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const username = msg.from.username || 'No username';
        const firstName = msg.from.first_name || '';
        const lastName = msg.from.last_name || '';

        const sql = `
            SELECT CurrentBalance
            FROM accounts
            WHERE UserID = ?
            LIMIT 1
        `;

        try {
            const [results] = await db.query(sql, [userId]);

            let balance = 'Not found';
            if (results && results.length > 0) {
                balance = `$${Number(results[0].CurrentBalance).toFixed(2)}`;
            }

            const message =
                `👤 *User Information*\n\n` +
                `🆔 *User ID:* \`${userId}\`\n` +
                `🔖 *Username:* ${username.startsWith('@') ? username : '@' + username}\n` +
                `📛 *Full Name:* ${firstName} ${lastName}\n` +
                `💰 *Balance:* ${balance}`;

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error("DB Error:", err);
            bot.sendMessage(chatId, "❌ Database error.");
        }
    });

    // ---------------------------------------------------------------------
    // /balance
    // ---------------------------------------------------------------------
    bot.onText(/\/balance/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id; // Telegram user ID

        try {
            // get all user payments
            const [payments] = await db.execute(
                "SELECT * FROM payments WHERE UserID = ?",
                [userId]
            );

            let balance = 0;
            const updates = [];

            for (const payment of payments) {
                if (payment.Status === "finished") {
                    balance += parseFloat(payment.Amount || 0);
                    continue;
                }

                // 🔍 check NowPayments invoice status
                const invoiceStatus = await getNowPaymentsInvoiceStatus(payment.PaymentID);

                if (!invoiceStatus) continue;

                if (invoiceStatus.status === "finished") {
                    // update payments table
                    await db.execute(
                        "UPDATE payments SET Status = 'finished' WHERE OrderID = ?",
                        [payment.OrderID]
                    );

                    const amount = parseFloat(invoiceStatus.price_amount) || 0;
                    balance += amount;

                    // update accounts table
                    await db.execute(
                        "UPDATE accounts SET CurrentBalance = COALESCE(CurrentBalance,0)+? WHERE UserID=?",
                        [amount, userId]
                    );

                    updates.push({ OrderID: payment.OrderID, status: "finished", amount });
                }
            }

            // get current balance from accounts
            const [[account]] = await db.execute(
                "SELECT CurrentBalance FROM accounts WHERE UserID = ?",
                [userId]
            );

            const finalBalance = account?.CurrentBalance || balance;

            bot.sendMessage(
                chatId,
                `🆔 Your UserID: ${userId}\n💰 Balance: ${finalBalance}\n\nRecent updates: ${updates.length}`
            );
        } catch (error) {
            console.error("❌ Error in /userid:", error);
            bot.sendMessage(chatId, "⚠️ Error checking your balance. Try again later.");
        }
    });

    // ---------------------------------------------------------------------
    // Generic message handler: /KeyStatus flow + forwarding to admin
    // ---------------------------------------------------------------------
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text?.trim();

        // Handle /KeyStatus command as before
        if (text && text.startsWith('/KeyStatus')) {
            if (waitingForKey.has(chatId)) {
                waitingForKey.delete(chatId);
                try {
                    const result = await getKeyStatusResponseMessage(text);
                    bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
                } catch (err) {
                    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
                }
            }
            return;
        }

        // Ignore other bot commands (anything starting with "/")
        if (text && text.startsWith('/')) return;

        // Forward ALL other messages (text, photo, video, gif, doc, etc.)
        bot.forwardMessage(ADMIN_ID, chatId, msg.message_id);

        // Send sender info (tap-to-copy ID)
        bot.sendMessage(
            ADMIN_ID,
            `📩 Forwarded message from ${msg.from.username ? '@' + msg.from.username : msg.from.first_name}\nID: \`${msg.from.id}\``,
            { parse_mode: 'MarkdownV2' }
        );
    });

// ---------------------------------------------------------------------
    // /userbalance <username>   (superadmin/admin only)
    // ---------------------------------------------------------------------
    bot.onText(/^\/userbalance (.+)$/, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;

        // --- superadmin / admin gate (moderator excluded) ---
        const [adminRows] = await db.execute(
            'SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1',
            [senderId]
        );

        if (adminRows.length === 0 || !['superadmin', 'admin'].includes(adminRows[0].Role)) {
            await bot.sendMessage(chatId, '❌ Error: You are not an active admin.');
            return;
        }

        const username = match[1].trim().replace(/^@/, '');

        const sql = `
            SELECT UserID, FirstName, LastName, Username, CurrentBalance
            FROM accounts
            WHERE LOWER(Username) = LOWER(?)
            LIMIT 1
        `;

        try {
            const [results] = await db.query(sql, [username]);

            if (!results || results.length === 0) {
                bot.sendMessage(chatId, `⚠️ No account found for username: ${username}`);
                return;
            }

            const user = results[0];

            const response =
                `💳 Balance Info:
        UserID: ${user.UserID}
        FirstName: ${user.FirstName || "-"}
        LastName: ${user.LastName || "-"}
        Username: ${user.Username ? '@' + user.Username : "-"}
        CurrentBalance: $${Number(user.CurrentBalance).toFixed(2)}`;

            bot.sendMessage(chatId, response);
        } catch (err) {
            console.error("DB Error:", err);
            bot.sendMessage(chatId, "❌ Database error.");
        }
    });

    // ---------------------------------------------------------------------
    // /userbalanceuserID <id>   (admin only)
    // ---------------------------------------------------------------------
    bot.onText(/^\/userbalanceuserID (\d+)$/, async (msg, match) => {
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
            if (isNaN(userId)) {
                bot.sendMessage(chatId, "⚠️ Invalid UserID. Example: /userbalanceuserID 12345");
                return;
            }

            const sql = `
                SELECT UserID, FirstName, LastName, Username, CurrentBalance
                FROM accounts
                WHERE UserID = ?
                LIMIT 1
            `;
            const [results] = await db.query(sql, [userId]);

            if (!results || results.length === 0) {
                bot.sendMessage(chatId, `⚠️ No account found for UserID: ${userId}`);
                return;
            }

            const user = results[0];

            const message =
`👤 *User Information*

🆔 *User ID:* \`${user.UserID}\`
🔖 *Username:* ${user.Username ? '@' + user.Username : "-"}
📛 *Full Name:* ${user.FirstName || "-"} ${user.LastName || "-"}
💰 *Balance:* $${Number(user.CurrentBalance).toFixed(2)}`;

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

        } catch (err) {
            console.error("DB Error:", err);
            bot.sendMessage(chatId, "❌ Database error.");
        }
    });

    // ---------------------------------------------------------------------
    // /usernameADDbalance <username> <amount>   (admin only)
    // ---------------------------------------------------------------------
    bot.onText(/^\/usernameADDbalance (.+) (.+)$/, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;

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

        const username = match[1].trim().replace(/^@/, '');
        const amount = parseFloat(match[2]);

        if (isNaN(amount) || amount <= 0) {
            bot.sendMessage(chatId, "⚠️ Invalid amount. Example: /usernameADDbalance arkh916058 5");
            return;
        }

        try {
            const [adminRows] = await db.execute(
                'SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1',
                [senderId]
            );

            if (adminRows.length === 0) {
                await bot.sendMessage(chatId, '❌ Error: You are not an active admin.');
                return;
            }

            const role = adminRows[0].Role;
            if (role !== 'admin' && role !== 'superadmin') {
                await bot.sendMessage(chatId, '❌ Error: You do not have permission.');
                return;
            }

            const [users] = await db.query(
                `SELECT UserID, CurrentBalance FROM accounts WHERE LOWER(Username) = LOWER(?) LIMIT 1`,
                [username]
            );

            if (!users || users.length === 0) {
                bot.sendMessage(chatId, `⚠️ No account found for username: ${username}`);
                return;
            }

            const user = users[0];
            const userId = user.UserID;

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
                `✅ Successfully added $${amount.toFixed(2)} to @${username}'s balance.\n💰 New Balance: $${Number(newBalance).toFixed(2)}`
            );
        } catch (err) {
            console.error("DB Error:", err);
            bot.sendMessage(chatId, "❌ Database error.");
        }
    });

    // ---------------------------------------------------------------------
    // /useridADDbalance <UserID> <amount>   (admin only)
    // ---------------------------------------------------------------------
    bot.onText(/\/useridADDbalance (\d+) (\d+(\.\d+)?)/, async (msg, match) => {
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
                bot.sendMessage(chatId, "⚠️ Invalid usage. Example: /useridADDbalance 12345 5");
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
        } catch (err) {
            console.error("DB Error:", err);
            bot.sendMessage(chatId, "❌ Database error.");
        }
    });

    // ---------------------------------------------------------------------
    // /sendMessage <userID> "<message>"   (admin only)
    // ---------------------------------------------------------------------
    bot.onText(/\/sendMessage (\d+) "(.*)"/, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;

        if (!match || match.length < 3 || match.length >= 4) {
            bot.sendMessage(chatId, "⚠️  Usage: /sendMessage <userID> \"<message>\"");
            return;
        }

        const userId = match[1];
        const message = match[2];

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

            await bot.sendMessage(userId, message);
            bot.sendMessage(chatId, `✅ Message ("${message}") sent to ${userId}`);

        } catch (err) {
            console.error("Error sending message:", err);
            bot.sendMessage(chatId, `❌ Failed to send message to ${userId}`);
        }
    });

bot.onText(/\/keyusername\s+@?([A-Za-z0-9_]+)/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const targetUsername = match[1].trim();

        try {
            const [adminRows] = await db.execute(
                'SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1',
                [senderId]
            );
            if (adminRows.length === 0) {
                await bot.sendMessage(chatId, '❌ Error: You are not an active admin.');
                return;
            }
            const role = adminRows[0].Role;
            if (role !== 'admin' && role !== 'superadmin') {
                await bot.sendMessage(chatId, '❌ Error: You do not have permission.');
                return;
            }

            const [accRows] = await db.execute(
                'SELECT UserID FROM accounts WHERE Username = ? LIMIT 1',
                [targetUsername]
            );
            if (accRows.length === 0) {
                await bot.sendMessage(chatId, `❌ No account found with username @${targetUsername}`);
                return;
            }
            const userId = accRows[0].UserID;

            // Now also pulling GuiKey + ServerName so we can look up
            // Usage/Limit (or Expired) for each key, same as /ks and
            // /servercheck do.
            const [keyRows] = await db.execute(
                'SELECT FullKey, GuiKey, ServerName, IssuedAt FROM UserKeys WHERE UserID = ? ORDER BY IssuedAt DESC',
                [userId]
            );
            if (keyRows.length === 0) {
                await bot.sendMessage(chatId, `ℹ️ No keys found for @${targetUsername}`);
                return;
            }

            const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            // Usage cache: one getKeysUsage() round-trip PER SERVER, no
            // matter how many of this user's keys are on that server —
            // same pattern as /ks's getUsageMapCached.
            const usageCache = {};
            const getUsageMapCached = async (serverName) => {
                if (!usageCache[serverName]) {
                    try {
                        usageCache[serverName] = await getKeysUsage(serverName, SERVERS, axios, https);
                    } catch (err) {
                        console.error(`Usage fetch failed for ${serverName}:`, err.message);
                        usageCache[serverName] = new Map();
                    }
                }
                return usageCache[serverName];
            };

            const LIMIT = 50;
            let response = `🔑 Keys for @${targetUsername} (UserID: ${userId}) — ${keyRows.length} total:\n\n`;

            for (const [i, row] of keyRows.slice(0, LIMIT).entries()) {
                const { FullKey, GuiKey, ServerName, IssuedAt } = row;

                const usageMap = await getUsageMapCached(ServerName);
                const info = usageMap.get((GuiKey || '').trim());
                const usageText = info
                    ? (info.limitBytes
                        ? `${formatBytes(info.bytes)}/${formatBytes(info.limitBytes)}`
                        : `${formatBytes(info.bytes)} (no limit)`)
                    : 'Expired';

                response += `${i + 1}. FullKey: <code>${escapeHtml(FullKey)}</code>\n   IssuedAt: ${escapeHtml(IssuedAt)}\n   Usage: ${escapeHtml(usageText)}\n\n`;
            }

            if (keyRows.length > LIMIT) {
                response += `...(showing ${LIMIT} of ${keyRows.length}). For the full list, query the DB directly.`;
            }

            await bot.sendMessage(chatId, response, { parse_mode: 'HTML', disable_web_page_preview: true });
        } catch (err) {
            console.error('Keyusername error:', err);
            await bot.sendMessage(chatId, `❌ Database error: ${err.code || err.message}`);
        }
    });

    // ---------------------------------------------------------------------
    // /keyuserid <userId|username>   (admin only)
    // ---------------------------------------------------------------------
    bot.onText(/\/keyuserid\s+@?([A-Za-z0-9_]+)/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const target = match[1].trim();

        try {
            const [adminRows] = await db.execute(
                'SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1',
                [senderId]
            );

            if (adminRows.length === 0) {
                await bot.sendMessage(chatId, '❌ Error: You are not an active admin.');
                return;
            }
            const role = adminRows[0].Role;
            if (role !== 'admin' && role !== 'superadmin') {
                await bot.sendMessage(chatId, '❌ Error: You do not have permission.');
                return;
            }

            let userId;
            if (/^\d+$/.test(target)) {
                userId = target;
            } else {
                const [accRows] = await db.execute(
                    'SELECT UserID FROM Accounts WHERE Username = ? LIMIT 1',
                    [target]
                );

                if (accRows.length === 0) {
                    await bot.sendMessage(chatId, `❌ No account found with username @${target}`);
                    return;
                }
                userId = accRows[0].UserID;
            }

            const [keyRows] = await db.execute(
                `SELECT FullKey, IssuedAt
                 FROM UserKeys
                 WHERE UserID = ? AND IssuedAt >= NOW() - INTERVAL 31 DAY
                 ORDER BY IssuedAt DESC`,
                [userId]
            );

            if (keyRows.length === 0) {
                await bot.sendMessage(chatId, `ℹ️ No keys issued in the last 31 days for ${target}`);
                return;
            }

            const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            let response = `📅 Keys issued in last 31 days for ${target} (UserID: ${userId}):\n\n`;
            keyRows.forEach((row, i) => {
                response += `${i + 1}. FullKey: <code>${escapeHtml(row.FullKey)}</code>\n   IssuedAt: ${escapeHtml(row.IssuedAt)}\n\n`;
            });

            await bot.sendMessage(chatId, response, { parse_mode: 'HTML' });

        } catch (err) {
            console.error('keyuserid error:', err);
            await bot.sendMessage(chatId, `❌ Database error: ${err.code || err.message}`);
        }
    });

    // ---------------------------------------------------------------------
    // /expiredkeys   (admin only)
    // ---------------------------------------------------------------------
    bot.onText(/\/expiredkeys/, async (msg) => {
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

            const [rows] = await db.query(
                `SELECT GuiKey, UserID
                 FROM UserKeys
                 WHERE DATE(IssuedAt) = CURDATE() - INTERVAL 30 DAY`
            );

            if (rows.length === 0) {
                await bot.sendMessage(chatId, "✅ No expired keys found today.");
                return;
            }

            let message = "🔑 *Expired Keys (30 days old)*\n\n";
            rows.forEach(row => {
                message += `👤 UserID: \`${row.UserID}\`\n🔑 GuiKey: \`${row.GuiKey}\`\n\n`;
            });

            await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });

        } catch (error) {
            console.error("Error fetching expired keys:", error);
            await bot.sendMessage(chatId, "❌ Error checking expired keys.");
        }
    });

    // ---------------------------------------------------------------------
    // /expiredkeysnotify   (admin only)
    // ---------------------------------------------------------------------
    bot.onText(/\/expiredkeysnotify/, async (msg) => {
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

            const [rows] = await db.execute(`
                SELECT UserID, GuiKey, ServerName
                FROM UserKeys
                WHERE DATE(ExpiredAt) = CURDATE();
            `);

            if (rows.length === 0) {
                await bot.sendMessage(chatId, '✅ No expired keys found.');
                return;
            }

            let reply = '🔑 *Expired Keys Still Active on Servers:*\n\n';
            let foundActiveKeys = false;

            for (const row of rows) {
                const { UserID, GuiKey, ServerName } = row;

                if (!UserID || !GuiKey) {
                    console.warn(`Skipping row with missing data:`, row);
                    continue;
                }

                const exists = await KeyExists(ServerName, GuiKey);

                if (exists) {
                    foundActiveKeys = true;
                    reply += `👤 UserID: \`${UserID}\`\n🗝️ Key: \`${GuiKey}\`\n🌐 Server: ${ServerName}\n\n`;

                    try {
                        await bot.sendMessage(UserID, `Hello👋\nYour key \`${GuiKey}\` is expired. Please contact the admin to renew it.`);
                        await bot.sendMessage(chatId, `✅ Expiration notice for \`${GuiKey}\` has been sent to \`${UserID}\``);
                    } catch (error) {
                        await bot.sendMessage(chatId, `❌ Failed to send message for \`${GuiKey}\` to \`${UserID}\`. Error: ${error.message}`);
                        // Optionally log this failure to a database or file
                    }
                }
            }

            if (!foundActiveKeys) {
                reply = '✅ No expired keys still active on servers.';
            }

            await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(err);
            await bot.sendMessage(chatId, '❌ Error fetching expired keys.');
        }
    });

    // ---------------------------------------------------------------------
    // /removekey <guikey|fullkey>   (admin only)
    // ---------------------------------------------------------------------
    bot.onText(/\/removekey\s+([\s\S]+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const input = match[1].trim();

        try {
            const [adminRows] = await db.execute(
                "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 AND Role IN ('admin','superadmin') LIMIT 1",
                [senderId]
            );
            if (!adminRows || adminRows.length === 0) {
                await bot.sendMessage(chatId, "❌ Error: You are not an active admin.");
                return;
            }

            const altGui = input.startsWith('#') ? input.substring(1).trim() : ('#' + input);

            let [rows] = await db.execute(
                "SELECT FullKey, GuiKey, ServerName FROM UserKeys WHERE GuiKey = ? OR GuiKey = ? LIMIT 1",
                [input, altGui]
            );

            if (!rows || rows.length === 0) {
                [rows] = await db.execute(
                    "SELECT FullKey, GuiKey, ServerName FROM UserKeys WHERE FullKey = ? LIMIT 1",
                    [input]
                );
            }

            if (!rows || rows.length === 0) {
                await bot.sendMessage(chatId, `❌ No key found with GuiKey or FullKey: ${input}`);
                return;
            }

            const row = rows[0];
            const storedGuiKey = row.GuiKey;
            const fullKey = row.FullKey;
            const serverName = row.ServerName;

            const server = SERVERS[serverName];
            if (!server) {
                await bot.sendMessage(chatId, `❌ Server config not found for: ${serverName}`);
                return;
            }

            let baseUrl = server.apiUrl || server.baseUrl || server.api;
            if (!baseUrl.endsWith('/')) baseUrl += '/';
            const listUrl = `${baseUrl}${server.apiKey}/access-keys`;
            const httpsAgent = new https.Agent({ rejectUnauthorized: false });

            let accessKeys = [];
            try {
                const resp = await axios.get(listUrl, { httpsAgent, timeout: 15000 });
                accessKeys = resp.data && resp.data.accessKeys
                    ? resp.data.accessKeys
                    : (Array.isArray(resp.data) ? resp.data : []);
            } catch (err) {
                const errMsg = err.response ? `HTTP ${err.response.status} ${err.response.statusText}` : err.message;
                await bot.sendMessage(chatId, `❌ Failed to fetch key list from server: ${errMsg}`);
                return;
            }

            const nameToFind = storedGuiKey.startsWith('#') ? storedGuiKey.substring(1).trim() : storedGuiKey.trim();
            const matchKey = accessKeys.find(k => {
                if (!k || typeof k.name !== 'string') return false;
                const n = k.name.trim();
                return n === nameToFind || n === storedGuiKey.trim() || n === ('#' + nameToFind);
            });

            if (!matchKey) {
                const altStored = storedGuiKey.startsWith('#') ? storedGuiKey.substring(1).trim() : ('#' + storedGuiKey);
                await db.execute("DELETE FROM UserKeys WHERE GuiKey = ? OR GuiKey = ? OR FullKey = ? LIMIT 1",
                    [storedGuiKey, altStored, fullKey]);
                await bot.sendMessage(chatId, `⚠️ Key "${storedGuiKey}" not found on server ${serverName}. Removed from DB only.`);
                return;
            }

            const keyId = matchKey.id || matchKey.keyId || matchKey.accessKeyId;
            if (!keyId) {
                await bot.sendMessage(chatId, `❌ Found key on server but couldn't determine its id.`);
                return;
            }

            const delUrl = `${baseUrl}${server.apiKey}/access-keys/${encodeURIComponent(keyId)}`;
            try {
                await axios.delete(delUrl, { httpsAgent, timeout: 15000 });
            } catch (err) {
                const errMsg = err.response ? `HTTP ${err.response.status} ${err.response.statusText}` : err.message;
                if (err.response && err.response.status === 404) {
                    const altStored = storedGuiKey.startsWith('#') ? storedGuiKey.substring(1).trim() : ('#' + storedGuiKey);
                    await db.execute("DELETE FROM UserKeys WHERE GuiKey = ? OR GuiKey = ? OR FullKey = ? LIMIT 1",
                        [storedGuiKey, altStored, fullKey]);
                    await bot.sendMessage(chatId, `⚠️ Server 404 (already gone). Removed "${storedGuiKey}" from DB.`);
                    return;
                }
                await bot.sendMessage(chatId, `❌ Failed to remove key on server: ${errMsg}`);
                return;
            }

            const altStored = storedGuiKey.startsWith('#') ? storedGuiKey.substring(1).trim() : ('#' + storedGuiKey);
            await db.execute("DELETE FROM UserKeys WHERE GuiKey = ? OR GuiKey = ? OR FullKey = ? LIMIT 1",
                [storedGuiKey, altStored, fullKey]);

            await bot.sendMessage(chatId, `✅ Key "${storedGuiKey}" removed from server ${serverName} and DB.`);

        } catch (error) {
            console.error("/removekey error:", error);
            await bot.sendMessage(chatId, `❌ Unexpected error: ${error.message}`);
        }
    });

    // ---------------------------------------------------------------------
    // /updatekey <OLD_KEY> <NEW_KEY>   (admin only)
    // ---------------------------------------------------------------------
    bot.onText(/\/updatekey\s+([\s\S]+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const target = match[1].trim();

        try {
            const [adminRows] = await db.execute(
                'SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1',
                [senderId]
            );

            if (adminRows.length === 0) {
                await bot.sendMessage(chatId, '❌ Error: You are not an active admin.');
                return;
            }

            const role = adminRows[0].Role;
            if (role !== 'admin' && role !== 'superadmin') {
                await bot.sendMessage(chatId, '❌ Error: You do not have permission.');
                return;
            }

            const firstSpaceIndex = target.indexOf(' ');
            if (firstSpaceIndex === -1) {
                await bot.sendMessage(
                    chatId,
                    '❌ Usage:\n/updatekey <OLD_KEY> <NEW_KEY>'
                );
                return;
            }

            const oldKey = target.substring(0, firstSpaceIndex).trim();
            const newKey = target.substring(firstSpaceIndex + 1).trim();

            if (!oldKey || !newKey) {
                await bot.sendMessage(
                    chatId,
                    '❌ Both old key and new key are required.'
                );
                return;
            }

            const extractGuiKey = (fullKey) => {
                const idx = fullKey.indexOf('#');
                return idx !== -1 ? fullKey.substring(idx) : fullKey;
            };

            const newGuiKey = extractGuiKey(newKey);

            const [rows] = await db.execute(
                `SELECT UserID, ServerName
                 FROM UserKeys
                 WHERE FullKey = ? OR GuiKey = ?
                 LIMIT 1`,
                [oldKey, oldKey]
            );

            if (rows.length === 0) {
                await bot.sendMessage(chatId, '❌ Old key not found in database.');
                return;
            }

            const [result] = await db.execute(
                `UPDATE UserKeys
                 SET FullKey = ?, GuiKey = ?
                 WHERE FullKey = ? OR GuiKey = ?`,
                [newKey, newGuiKey, oldKey, oldKey]
            );

            if (result.affectedRows === 0) {
                await bot.sendMessage(
                    chatId,
                    '❌ Update failed. No rows affected.'
                );
                return;
            }

            await bot.sendMessage(
                chatId,
                `✅ Key updated successfully.\n\n🆕 GuiKey:\n${newGuiKey}`
            );

        } catch (err) {
            console.error('updatekey error:', err);
            await bot.sendMessage(chatId, '❌ Internal error occurred.');
        }
    });

    // ---------------------------------------------------------------------
    // /hc or /HiddenCommands   (admin only)
    // ---------------------------------------------------------------------
    bot.onText(/\/(hc|HiddenCommands)/, async (msg) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;

        try {
            const [adminRows] = await db.execute(
                'SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1',
                [senderId]
            );

            if (adminRows.length === 0) {
                await bot.sendMessage(chatId, '❌ Error: You are not an active admin.');
                return;
            }

            const role = adminRows[0].Role;
            if (role !== 'admin' && role !== 'superadmin') {
                await bot.sendMessage(chatId, '❌ Error: You do not have permission.');
                return;
            }

            const commandKeyboard = {
                reply_markup: {
                    keyboard: [
                        ["/expiredkeys"],
                        ["/expiredkeysnotify"],
                        ["/useridADDbalance"],
                        ["/usernameADDbalance"],
                        ["/userbalanceuserID"],
                        ["/userbalance"],
                        ["/sendMessage"],
                        ["/keyusername"],
                        ["/keyuserid"],
                        ["/removekey"]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };

            await bot.sendMessage(chatId, "🔒 Hidden Commands:\nTap a command to auto-populate:", commandKeyboard);

        } catch (err) {
            console.error("Error checking admin:", err);
            await bot.sendMessage(chatId, "⚠️ Internal error, please try again later.");
        }
    });
};
