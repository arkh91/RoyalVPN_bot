//main
const axios = require('axios'); //removekey command
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const insertUser = require('./db/insertUser');
const insertVisit = require('./db/insertVisit');
const { createNewKey } = require('./db/KeyCreation');
const { createInternationalKey } = require('./db/KeyCreationInternational');
const checkBalance = require('./checkBalance');
const { getKeyStatusResponseMessage } = require('./KeyStatus');
const checkEligible = require ('./checkEligibility');
const Game_Arena_checkEligible = require ('./Game_Arena_checkEligibility');
const getUserBalance = require('./db/getUserBalance'); // adjust path as needed
const deductBalance = require('./db/deductBalance');   // same here
//const { checkBalance, updatePendingPayments } = require('./payments');
//const { updatePendingPayments } = require('./payments');
const db = require('./db');
const mysql = require('mysql');
console.log("✅ MySQL module loaded successfully");
const getNowPaymentsStatus = require('./getNowPaymentsStatus');
const updatePendingPayments = require('./updatePendingPayments');
//const getNowPaymentsInvoiceStatus = require('./getNowPaymentsStatus');
const fs = require('fs');
//const getNowPaymentsInvoiceStatus = require("../getNowPaymentsInvoiceStatus");
const getNowPaymentsInvoiceStatus = require('./getNowPaymentsInvoiceStatus');
const KeyExists = require('./db/keyExists');
const SERVERS = require('./servers'); //removekey command
const https = require('https'); //removekey command

let callbackToServer = {};
let callbackToInternationalServer = {};



const token = ''; //RoyalVPN
//const token = ''; //Test
//const { TELEGRAM_BOT_TOKEN } = require('./token');
const { NOWPAYMENTS_API_KEY } = require('./token');
//const NOWPAYMENTS_API_KEY = '';

const createNowPaymentsSession = require('./createNowPaymentsSession');

// Function to load JSON config
function loadConfig() {
    const raw = fs.readFileSync('./callbacks.json');
    const config = JSON.parse(raw);

    callbackToServer = config.callbackToServer;
    callbackToInternationalServer = config.callbackToInternationalServer;

    console.log('✅ Callbacks loaded');
}

// Initial load
loadConfig();

// Watch file for changes
fs.watchFile('./callbacks.json', { interval: 2000 }, () => {
    try {
        console.log('⚡ callbacks.json updated, reloading...');
        loadConfig();
    } catch (err) {
        console.error('❌ Failed to reload callbacks.json:', err);
    }
});

const waitingForKey = new Set();

const bot = new TelegramBot(token, {
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

// Export for use in webhook.js
//module.exports = bot;


const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'IRAN🇮🇷', callback_data: 'menu_1' }],
            [{ text: 'Russia🇷🇺', callback_data: 'menu_Russia' }],
            [{ text: 'International 🌐', callback_data: 'sub_INT_speed' }]
        ]
    }
};

const subMenus = {
    menu_1: {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Game', callback_data: 'sub_1_game' }],
                [{ text: 'High Speed', callback_data: 'sub_Outline_VS_WireGuard' }],
                [{ text: '⬅️ Go Back', callback_data: 'back_to_main' }]
            ]
        }
    },
    sub_Outline_VS_WireGuard: {
        text: 'Please choose the VPN system:',
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Outline', callback_data: 'sub_1_speed' }],
                [{ text: 'WireGuard', callback_data: 'sub_wgvpn' }],
                [{ text: '⬅️ Go Back', callback_data: 'menu_1' }]
            ]
        }
    },
    sub_wgvpn: {
        text: '⚡ Choose a high-speed location for fast and secure internet with WireGuard:',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Germany 🇩🇪', callback_data: 'wg_speed_ger' },
                    { text: 'Sweden 🇸🇪', callback_data: 'wg_speed_sweden' }
                ],
                [
                    { text: 'Finland 🇫🇮 ', callback_data: 'wg_speed_fin' },
                    //{ text: 'Iran 🇮🇷', callback_data: 'speed_ir' }
                    { text: 'Italy 🇮🇹 ', callback_data: 'wg_speed_it' }
                ],
                [
                    { text: 'Nigeria 🇳🇬 ', callback_data: 'wg_speed_nig' },
                    { text: 'Turkey 🇹🇷 ', callback_data: 'wg_speed_tur' }
                ],
                [
                    { text: 'India 🇮🇳', callback_data: 'wg_speed_in' },
                    { text: 'Egypt 🇪🇬 ' , callback_data: 'wg_speed_eg' }
                ],
                [
                    { text: 'UK 🇬🇧 ', callback_data: 'wg_speed_uk' },
                    { text: 'USA 🇺🇸', callback_data: 'wg_speed_usa' }
                ],
                [{ text: '⬅️ Go Back', callback_data: 'sub_Outline_VS_WireGuard' }]
            ]
        }
    },
    sub_wg_number_user: {
        text: 'Please choose the number of devices: ',
        reply_markup: {
           inline_keyboard: [
                [{ text: '1 device', callback_data: 'wg_number_one_devices' }],
                [{ text: '2 devices', callback_data: 'wg_number_two_devices' }],
                [{ text: '3 devices', callback_data: 'wg_number_three_devices' }],
                [{ text: '⬅️ Go Back', callback_data: 'sub_wgvpn' }]
           ]
        }
    },

    sub_wgvpn_traffic: {
        text: 'Select your 30-day WireGuard traffic package:',
            reply_markup: {
              inline_keyboard: [
                  [{ text: '40 GB / 1.10 USD', callback_data: 'wg_bw_40' }],
                  [{ text: '50 GB / 1.29 USD', callback_data: 'wg_bw_50' }],
                  [{ text: '70 GB / 1.95 USD', callback_data: 'wg_bw_70' }],
                  [{ text: '100 GB / 2.33 USD', callback_data: 'wg_bw_100' }],
                  [{ text: '300 GB / 5.60 USD', callback_data: 'wg_bw_300' }],
                  //[{ text: '500 GB / 9.30 USD', callback_data: 'bw_500' }],
                  [{ text: '1000 GB / 16.99 USD', callback_data: 'wg_bw_1000' }],
                  { text: '⬅️ Go Back', callback_data: 'sub_wg_number_user' }
             ]
         }
      },

    sub_1_game: {
        text: '� Choose a game-optimized server for smoother, faster gameplay:',
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Arena Breakout', callback_data: 'game_arena' }],
                [{ text: 'FIFA', callback_data: 'game_fifa' }],
                [{ text: 'Call of Duty Mobile', callback_data: 'game_codm' }],
                [{ text: '⬅️ Go Back', callback_data: 'menu_1' }]
            ]
        }
    },
    game_arena: {
        text: '🎮 Arena Breakout – Select your package:',
        reply_markup: {
                inline_keyboard: [
                        [{ text: '25 GB – $0.99', callback_data: 'arena_25gb' }],
                        [{ text: '50 GB – $1.89', callback_data: 'arena_50gb' }],
                        [{ text: '⬅️ Go Back', callback_data: 'sub_1_game' }]
                ]
        }
    },
    sub_1_speed: {
        text: '⚡ Choose a high-speed location for fast and secure internet:',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Germany 🇩🇪', callback_data: 'speed_ger' },
                    { text: 'Sweden 🇸🇪', callback_data: 'speed_sweden' }
                ],
                [
                    { text: 'Finland 🇫🇮 ', callback_data: 'speed_fin' },
                    //{ text: 'Iran 🇮🇷', callback_data: 'speed_ir' }
                    { text: 'Italy 🇮🇹 ', callback_data: 'speed_it' }
                ],
                [
                    { text: 'Nigeria 🇳🇬 ', callback_data: 'speed_nig' },
                    { text: 'Turkey 🇹🇷 ', callback_data: 'speed_tur' }
                ],
                [
                    { text: 'India 🇮🇳', callback_data: 'speed_in' },
                    { text: 'Egypt 🇪🇬 ' , callback_data: 'speed_eg' }
                ],
                [
                    { text: 'UK 🇬🇧 ', callback_data: 'speed_uk' },
                    { text: 'USA 🇺🇸', callback_data: 'speed_usa' }
                ],
                [{ text: '⬅️ Go Back', callback_data: 'menu_1' }]
            ]
        }
    },
    bandwidth_menu: {
        text: 'Select the 30-day Outline bandwidth limit:',
        reply_markup: {
            inline_keyboard: [
                [{ text: '40 GB / 1.10 USD', callback_data: 'bw_40' }],
                [{ text: '50 GB / 1.29 USD', callback_data: 'bw_50' }],
                [{ text: '70 GB / 1.95 USD', callback_data: 'bw_70' }],
                [{ text: '100 GB / 2.33 USD', callback_data: 'bw_100' }],
                [{ text: '300 GB / 5.60 USD', callback_data: 'bw_300' }],
                //[{ text: '500 GB / 9.30 USD', callback_data: 'bw_500' }],
                [{ text: '1000 GB / 16.99 USD', callback_data: 'bw_1000' }],
                [{ text: '⬅️ Go Back', callback_data: 'sub_1_speed' }]
            ]
        }
    },
    /*menu_INT: {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Game', callback_data: 'sub_1_game' }],
                [{ text: 'High Speed', callback_data: 'sub_1_speed' }],
                [{ text: '⬅️ Go Back', callback_data: 'back_to_main' }]
            ]
        }
    },*/
    sub_INT_speed: {
        text: '⚡ Choose a high-speed location for fast and secure internet: 🌐',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Germany 🇩🇪', callback_data: 'int_speed_ger' },
                    { text: 'Sweden 🇸🇪', callback_data: 'int_speed_sweden' }
                ],
                [
                    //{ text: 'Spain 🇪🇸', callback_data: 'int_speed_sp' },
                    { text: 'Finland 🇫 🇮  ', callback_data: 'int_speed_fin' },
                    { text: 'Iran 🇮🇷', callback_data: 'int_speed_ir' }
                ],
                [
                    { text: 'Italy 🇮🇹', callback_data: 'int_speed_it' },
                    { text: 'Armenia 🇦🇲', callback_data: 'int_speed_arm' }
                ],
                [
                    { text: 'USA 🇺🇸', callback_data: 'int_speed_usa' },
                    { text: 'UK 🇬🇧', callback_data: 'int_speed_uk' }
                ],
                [{ text: '⬅️ Go Back', callback_data: 'back_to_main' }]
            ]
        }
    },
    bandwidth_menu_int: {
        text: 'Select the 30-day Outline bandwidth limit:',
        reply_markup: {
            inline_keyboard: [
                [{ text: '50 GB / 1.29 USD', callback_data: 'int_bw_50' }],
                [{ text: '100 GB / 2.33 USD', callback_data: 'int_bw_100' }],
                [{ text: '300 GB / 5.60 USD', callback_data: 'int_bw_300' }],
                [{ text: '500 GB / 9.30 USD', callback_data: 'int_bw_500' }],
                [{ text: '1000 GB / 16.99 USD', callback_data: 'int_bw_1000' }],
                [{ text: '⬅️ Go Back', callback_data: 'sub_INT_speed' }]
            ]
        }
    },


};
/*
async function checkBalance(userId) {
    return true; // Replace with actual DB logic later
}
*/
(async () => {
    const result = await checkBalance(123456);
    console.log('Balance check result:', result);
})();


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

bot.onText(/^\/userid$/, async (msg) => {
//bot.onText(/\/userid/, async (msg) => {
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



// Show balance
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

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    const ADMIN_ID = 542797568;

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


// 🌐 Mapping for Internatinal Accounts
/*
bot.onText(/\/ks/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    // Fetch keys from the last 45 days
    const [rows] = await db.execute(
      `SELECT FullKey, GuiKey, ServerName, IssuedAt
       FROM UserKeys
       WHERE UserID = ?
         AND IssuedAt >= NOW() - INTERVAL 45 DAY
       ORDER BY IssuedAt DESC`,
      [userId]
    );

    if (rows.length === 0) {
      return bot.sendMessage(chatId, "❌ No keys found in the last 45 days.");
    }

    let message = `🔑 Keys for UserID: \`${userId}\` — ${rows.length} total:\n\n`;

    let count = 1;
    for (const row of rows) {
      const { FullKey, GuiKey, ServerName, IssuedAt } = row;

      // Check key status
      const exists = await KeyExists(ServerName, GuiKey);
      const statusText = exists ? "**Active**" : "**Not Active**";

      // Format date
      const issued = new Date(IssuedAt).toDateString().slice(0, 10);

      message += `${count}. FullKey: \`${FullKey}\`\n`;
      message += `   IssuedAt: ${issued}\n`;
      message += `   Status: ${statusText}\n\n`;

      count++;
    }

    await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Error fetching keys:", err);
    await bot.sendMessage(chatId, "⚠️ Error fetching your keys. Please try again later.");
  }
});
*/
bot.onText(/\/ks/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    // Fetch keys from the last 45 days
    const [rows] = await db.execute(
      `SELECT FullKey, GuiKey, ServerName, IssuedAt
       FROM UserKeys
       WHERE UserID = ?
         AND IssuedAt >= NOW() - INTERVAL 45 DAY
       ORDER BY IssuedAt DESC`,
      [userId]
    );

    if (rows.length === 0) {
      return bot.sendMessage(chatId, "❌ No keys found in the last 45 days.");
    }

    const escapeHTML = (text) =>
      text.replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

    let message = `🔑 Keys for UserID: <code>${escapeHTML(String(userId))}</code> — ${rows.length} total:\n\n`;
    let messages = [];
    let count = 1;

    for (const row of rows) {
      const { FullKey, GuiKey, ServerName, IssuedAt } = row;
      const exists = await KeyExists(ServerName, GuiKey);
      const statusText = exists ? "<b>Active</b>" : "<b>Not Active</b>";
      const issued = new Date(IssuedAt).toDateString().slice(0, 10);

      const entry =
        `${count}. FullKey: <code>${escapeHTML(FullKey)}</code>\n` +
        `   IssuedAt: ${escapeHTML(issued)}\n` +
        `   Status: ${statusText}\n\n`;

      if (message.length + entry.length > 4000) {
        messages.push(message);
        message = "";
      }
      message += entry;
      count++;
    }

    if (message.length > 0) messages.push(message);

    for (const part of messages) {
      await bot.sendMessage(chatId, part, { parse_mode: "HTML" });
    }
  } catch (err) {
    console.error("Error fetching keys:", err);
    await bot.sendMessage(chatId, "⚠️ Error fetching your keys. Please try again later.");
  }
});



bot.onText(/^\/userbalance (.+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const ADMIN_ID = 542797568;

    if (msg.from.id !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ Error: No admin detected!');
        return;
    }

    //const username = match[1].trim();
        // Trim and remove leading @ if present
    const username = match[1].trim().replace(/^@/, '');

    const sql = `
        SELECT UserID, FirstName, LastName, Username, CurrentBalance
        FROM accounts
        WHERE LOWER(Username) = LOWER(?)
        LIMIT 1
    `;

    try {
        // Use promise-based query
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



bot.onText(/^\/userbalanceuserID (\d+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    try {
        // 1) Check sender is active admin using COUNT
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

        // 2) Validate input
        const userId = parseInt(match[1]);
        if (isNaN(userId)) {
            bot.sendMessage(chatId, "⚠️ Invalid UserID. Example: /userbalanceuserID 12345");
            return;
        }

        // 3) Query account
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

        // 4) Build response (Markdown inline formatting)
        const message =
`👤 *User Information*

🆔 *User ID:* \`${user.UserID}\`
🔖 *Username:* ${user.Username ? '@' + user.Username : "-"}
📛 *Full Name:* ${user.FirstName || "-"} ${user.LastName || "-"}
💰 *Balance:* $${Number(user.CurrentBalance).toFixed(2)}`;

        // 5) Send
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (err) {
        console.error("DB Error:", err);
        bot.sendMessage(chatId, "❌ Database error.");
    }
});


bot.onText(/^\/usernameADDbalance (.+) (.+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

        // 1) Check sender is active admin using COUNT
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
 // 1) Check sender is active admin
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
        // 1. Get user from accounts
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

        // 2. Generate IDs
        const now = new Date();
        const pad = n => (n < 10 ? '0' + n : n);
        const ddmmyyyy = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}`;
        const hhmmss = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const orderId = `${ddmmyyyy}-${hhmmss}`;
        const paymentId = orderId;
        const invoiceId = orderId;

        // 3. Insert payment record
        const insertQuery = `
            INSERT INTO payments
            (UserID, PaymentDate, PaymentMethod, DigitalCurrencyAmount, Currency, AmountPaidInUSD, CurrentRateToUSD, Status, Comments, OrderID, PaymentID, invoiceID)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const insertParams = [
            userId,
            now,
            'Rial',
            0, // numeric field
            'Rial',
            amount,
            0, // numeric field
            'Pending',
            'Pending via TelegramBot',
            orderId,
            paymentId,
            invoiceId
        ];
        await db.query(insertQuery, insertParams);

        // 4. Update account balance
        const updateQuery = `
            UPDATE accounts
            SET CurrentBalance = CurrentBalance + ?
            WHERE UserID = ?
        `;
        await db.query(updateQuery, [amount, userId]);

        // 5. Fetch new balance
        const [updatedUser] = await db.query(
            `SELECT CurrentBalance FROM accounts WHERE UserID = ? LIMIT 1`,
            [userId]
        );

        const newBalance = updatedUser[0].CurrentBalance;

        // 6. Send success response
        bot.sendMessage(
            chatId,
            `✅ Successfully added $${amount.toFixed(2)} to @${username}'s balance.\n💰 New Balance: $${Number(newBalance).toFixed(2)}`
        );
    } catch (err) {
        console.error("DB Error:", err);
        bot.sendMessage(chatId, "❌ Database error.");
    }
});

// /useridADDbalance <UserID> <amount>
bot.onText(/\/useridADDbalance (\d+) (\d+(\.\d+)?)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    try {
        // 1) Check sender is active admin using COUNT
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

        // Extract params
        const userId = parseInt(match[1]);
        const amount = parseFloat(match[2]);

        if (isNaN(userId) || isNaN(amount) || amount <= 0) {
            bot.sendMessage(chatId, "⚠️ Invalid usage. Example: /useridADDbalance 12345 5");
            return;
        }

        // 2. Get user from accounts
        const [users] = await db.query(
            `SELECT UserID, Username, CurrentBalance FROM accounts WHERE UserID = ? LIMIT 1`,
            [userId]
        );

        if (!users || users.length === 0) {
            bot.sendMessage(chatId, `⚠️ No account found for UserID: ${userId}`);
            return;
        }

        const user = users[0];

        // 3. Generate IDs
        const now = new Date();
        const pad = n => (n < 10 ? '0' + n : n);
        const ddmmyyyy = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}`;
        const hhmmss = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const orderId = `${ddmmyyyy}-${hhmmss}`;
        const paymentId = orderId;
        const invoiceId = orderId;

        // 4. Insert payment record
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

        // 5. Update balance
        const updateQuery = `
            UPDATE accounts
            SET CurrentBalance = CurrentBalance + ?
            WHERE UserID = ?
        `;
        await db.query(updateQuery, [amount, userId]);

        // 6. Fetch updated balance
        const [updatedUser] = await db.query(
            `SELECT CurrentBalance FROM accounts WHERE UserID = ? LIMIT 1`,
            [userId]
        );

        const newBalance = updatedUser[0].CurrentBalance;

        // 7. Success message
        bot.sendMessage(
            chatId,
            `✅ Successfully added $${amount.toFixed(2)} to ${user.Username ? '@' + user.Username : 'UserID ' + userId}'s balance.\n💰 New Balance: $${Number(newBalance).toFixed(2)}`
        );
    } catch (err) {
        console.error("DB Error:", err);
        bot.sendMessage(chatId, "❌ Database error.");
    }
});


bot.onText(/\/sendMessage (\d+) "(.*)"/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    if (!match || match.length < 3 || match.length >= 4) {
        bot.sendMessage(chatId, "⚠️  Usage: /sendMessage <userID> \"<message>\"");
        return;
    }

    const userId = match[1];   // group 1 = userID
    const message = match[2];  // group 2 = text inside quotes

    try {
        // 1) Check sender is active admin using COUNT
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
//        bot.sendMessage(chatId, `✅ Message sent to ${userId}`);
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
    // 1) check sender is active admin
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

    // 2) find UserID in Accounts table
    const [accRows] = await db.execute(
      'SELECT UserID FROM accounts WHERE Username = ? LIMIT 1',
      [targetUsername]
    );

    if (accRows.length === 0) {
      await bot.sendMessage(chatId, `❌ No account found with username @${targetUsername}`);
      return;
    }
    const userId = accRows[0].UserID;

    // 3) fetch keys
    const [keyRows] = await db.execute(
      'SELECT FullKey, IssuedAt FROM UserKeys WHERE UserID = ? ORDER BY IssuedAt DESC',
      [userId]
    );

    if (keyRows.length === 0) {
      await bot.sendMessage(chatId, `ℹ️ No keys found for @${targetUsername}`);
      return;
    }

    // escape for HTML parse_mode
    const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const LIMIT = 50;
    let response = `🔑 Keys for @${targetUsername} (UserID: ${userId}) — ${keyRows.length} total:\n\n`;
    keyRows.slice(0, LIMIT).forEach((row, i) => {
      response += `${i + 1}. FullKey: <code>${escapeHtml(row.FullKey)}</code>\n   IssuedAt: ${escapeHtml(row.IssuedAt)}\n\n`;
    });
    if (keyRows.length > LIMIT) {
      response += `...(showing ${LIMIT} of ${keyRows.length}). For the full list, query the DB directly.`;
    }

    await bot.sendMessage(chatId, response, { parse_mode: 'HTML', disable_web_page_preview: true });

  } catch (err) {
    console.error('Keyusername error:', err);
    await bot.sendMessage(chatId, `❌ Database error: ${err.code || err.message}`);
  }
});


bot.onText(/\/keyuserid\s+@?([A-Za-z0-9_]+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
  const target = match[1].trim();

  try {
    // 1) check sender is active admin
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
      // 2a) numeric: treat as UserID
      userId = target;
    } else {
      // 2b) string: look up by username in Accounts
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

    // 3) fetch keys issued in last 31 days
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

    // escape HTML
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


bot.onText(/\/expiredkeys/, async (msg) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id; // Telegram user ID of sender

    try {
        // 1) Check sender is active admin using COUNT
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

        // 2) Fetch expired keys
        const [rows] = await db.query(
            `SELECT GuiKey, UserID
             FROM UserKeys
             WHERE DATE(IssuedAt) = CURDATE() - INTERVAL 30 DAY`
        );

        if (rows.length === 0) {
            await bot.sendMessage(chatId, "✅ No expired keys found today.");
            return;
        }

        // 3) Build response
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

bot.onText(/\/expiredkeysnotify/, async (msg) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    try {
        // 1) Check sender is active admin using COUNT
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

        //console.log('✅Raw rows from database: "expiredkeysnotify"', rows); // Debugging

        if (rows.length === 0) {
            await bot.sendMessage(chatId, '✅ No expired keys found.');
            return;
        }

        let reply = '🔑 *Expired Keys Still Active on Servers:*\n\n';
        let foundActiveKeys = false;

        for (const row of rows) {
            //console.log('Processing row:', row); // Debugging

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
                        //console.log(`Expiration notice sent to UserID: ${UserID}`);
                        await bot.sendMessage(chatId, `✅ Expiration notice for \`${GuiKey}\` has been sent to \`${UserID}\``);
                        //await bot.sendMessage(chatId, `✅ Expiration notice for \`${GuiKey}\` has been sent to \`${UserID}\``, {parse_mode: 'MarkdownV2'});
//await bot.sendMessage(chatId, `✅ Expiration notice for \`${GuiKey}\` has been sent to \`${UserID}\``, {parse_mode: 'MarkdownV2'});
                } catch (error) {
                        //console.error(`Failed to send expiration notice to UserID: ${UserID}`, error);
                        await bot.sendMessage(chatId, `❌ Failed to send message for \`${GuiKey}\` to \`${UserID}\`. Error: ${error.message}`);
                        //await bot.sendMessage(chatId, `❌ Failed to send message for \`${GuiKey}\` to \`${UserID}\`. Error: ${error.message}`, {parse_mode: 'MarkdownV2'});

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


bot.onText(/\/removekey\s+([\s\S]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
  const input = match[1].trim();

  try {
    // --- 1) admin check ---
    const [adminRows] = await db.execute(
      "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 AND Role IN ('admin','superadmin') LIMIT 1",
      [senderId]
    );
    if (!adminRows || adminRows.length === 0) {
      await bot.sendMessage(chatId, "❌ Error: You are not an active admin.");
      return;
    }

    // --- 2) find key in DB ---
    const altGui = input.startsWith('#') ? input.substring(1).trim() : ('#' + input);

    // try GuiKey first
    let [rows] = await db.execute(
      "SELECT FullKey, GuiKey, ServerName FROM UserKeys WHERE GuiKey = ? OR GuiKey = ? LIMIT 1",
      [input, altGui]
    );

    // if not found, try FullKey
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

    // --- 3) get server config ---
    const server = SERVERS[serverName];
    if (!server) {
      await bot.sendMessage(chatId, `❌ Server config not found for: ${serverName}`);
      return;
    }

    // --- 4) base URL ---
    let baseUrl = server.apiUrl || server.baseUrl || server.api;
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    const listUrl = `${baseUrl}${server.apiKey}/access-keys`;
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    // --- 5) fetch access keys from server ---
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

    // normalize
    const nameToFind = storedGuiKey.startsWith('#') ? storedGuiKey.substring(1).trim() : storedGuiKey.trim();
    const matchKey = accessKeys.find(k => {
      if (!k || typeof k.name !== 'string') return false;
      const n = k.name.trim();
      return n === nameToFind || n === storedGuiKey.trim() || n === ('#' + nameToFind);
    });

    if (!matchKey) {
      // Key not found on server — remove from DB only
      const altStored = storedGuiKey.startsWith('#') ? storedGuiKey.substring(1).trim() : ('#' + storedGuiKey);
      await db.execute("DELETE FROM UserKeys WHERE GuiKey = ? OR GuiKey = ? OR FullKey = ? LIMIT 1",
        [storedGuiKey, altStored, fullKey]);
      await bot.sendMessage(chatId, `⚠️ Key "${storedGuiKey}" not found on server ${serverName}. Removed from DB only.`);
      return;
    }

    // get id for deletion
    const keyId = matchKey.id || matchKey.keyId || matchKey.accessKeyId;
    if (!keyId) {
      await bot.sendMessage(chatId, `❌ Found key on server but couldn't determine its id.`);
      return;
    }

    // --- 6) DELETE on server ---
    const delUrl = `${baseUrl}${server.apiKey}/access-keys/${encodeURIComponent(keyId)}`;
    try {
      await axios.delete(delUrl, { httpsAgent, timeout: 15000 });
    } catch (err) {
      const errMsg = err.response ? `HTTP ${err.response.status} ${err.response.statusText}` : err.message;
      if (err.response && err.response.status === 404) {
        // already gone, still remove from DB
        const altStored = storedGuiKey.startsWith('#') ? storedGuiKey.substring(1).trim() : ('#' + storedGuiKey);
        await db.execute("DELETE FROM UserKeys WHERE GuiKey = ? OR GuiKey = ? OR FullKey = ? LIMIT 1",
          [storedGuiKey, altStored, fullKey]);
        await bot.sendMessage(chatId, `⚠️ Server 404 (already gone). Removed "${storedGuiKey}" from DB.`);
        return;
      }
      await bot.sendMessage(chatId, `❌ Failed to remove key on server: ${errMsg}`);
      return;
    }

    // --- 7) remove from DB ---
    const altStored = storedGuiKey.startsWith('#') ? storedGuiKey.substring(1).trim() : ('#' + storedGuiKey);
    await db.execute("DELETE FROM UserKeys WHERE GuiKey = ? OR GuiKey = ? OR FullKey = ? LIMIT 1",
      [storedGuiKey, altStored, fullKey]);

    await bot.sendMessage(chatId, `✅ Key "${storedGuiKey}" removed from server ${serverName} and DB.`);

  } catch (error) {
    console.error("/removekey error:", error);
    await bot.sendMessage(chatId, `❌ Unexpected error: ${error.message}`);
  }
});

bot.onText(/\/updatekey\s+([\s\S]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
  const target = match[1].trim();

  try {
    // 1) check sender is active admin
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

    // 2) parse OLD_KEY and NEW_KEY (split ONLY on first space)
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

    // 3) extract GuiKey from new key
    const extractGuiKey = (fullKey) => {
      const idx = fullKey.indexOf('#');
      return idx !== -1 ? fullKey.substring(idx) : fullKey;
    };

    const newGuiKey = extractGuiKey(newKey);

    // 4) verify old key exists
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

    // 5) update key
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

    // 6) success
    await bot.sendMessage(
      chatId,
      `✅ Key updated successfully.\n\n🆕 GuiKey:\n${newGuiKey}`
    );

  } catch (err) {
    console.error('updatekey error:', err);
    await bot.sendMessage(chatId, '❌ Internal error occurred.');
  }
});


// Hidden Commands (Admin Only)
bot.onText(/\/(hc|HiddenCommands)/, async (msg) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    try {
        // 1) Check sender is active admin
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

        // 2) Reply keyboard with tappable commands
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
                resize_keyboard: true,   // compact keyboard
                one_time_keyboard: true  // auto-hide after use
            }
        };

        await bot.sendMessage(chatId, "🔒 Hidden Commands:\nTap a command to auto-populate:", commandKeyboard);

    } catch (err) {
        console.error("Error checking admin:", err);
        await bot.sendMessage(chatId, "⚠️ Internal error, please try again later.");
    }
});


bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const userId = query.from.id;
    //console.log(`[TRACE] User=${userId} | Data=${data}`);

// !
    if (data === "speed_eg" || data === "speed_tur") {
        return bot.editMessageText(
                "⚠️ The chosen server is under development.\nPlease contact support.",
                {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                        inline_keyboard: [
                        [
                                {
                                text: "⬅️ Back",
                                callback_data: "sub_1_speed"
                                }
                        ]
                        ]
                }
                }
        );
     }


    const regularSpeedCallbacks = Object.keys(callbackToServer); // i.e., speed_usa, speed_ir, etc.

    if (regularSpeedCallbacks.includes(data)) {
        const selectedServer = callbackToServer[data];
        bot.session = bot.session || {};
        bot.session[userId] = {
                selectedServer,
                isInternational: false   // ✅ Optional, but helpful for clarity
        };

        const bandwidthMenu = subMenus.bandwidth_menu;
        return bot.editMessageText(bandwidthMenu.text, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: bandwidthMenu.reply_markup
        });
     }



    const internationalSpeedCallbacks = Object.keys(callbackToInternationalServer);

    if (internationalSpeedCallbacks.includes(data)) {
        const selectedServer = callbackToInternationalServer[data];
        bot.session = bot.session || {};
        bot.session[userId] = {
                selectedServer,
                isInternational: true    // ✅ Add this flag
        };

        const bandwidthMenu = subMenus.bandwidth_menu_int;  // ✅ Also make sure this is the INT menu
        return bot.editMessageText(bandwidthMenu.text, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: bandwidthMenu.reply_markup
        });
    }


    if (data === 'menu_Russia') {
        return bot.sendMessage(chatId, '⚠️ The Russia section is under development. Please check back later.');
    }

    if (data === 'speed_ger') {
        return bot.sendMessage(chatId, '⚠️ Germany server is under development. Please check back later.');
    }


    // SUBMENUS HANDLING
    if (subMenus[data]) {
        const submenu = subMenus[data];
        const text = submenu.text || `Gaming Focused VPN:\nLevel up your gaming with our VPN—reduce ping, bypass geo-restrictions, and stay secure on any server.\n\nHigh Speed VPN:\nProtect your privacy with our high-quality VPN—lightning-fast, ultra-secure, and trusted by professionals worldwide.`;
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: submenu.reply_markup
        });
    }

    // PAYMENTS MAIN MENU
    if (data === 'payments') {
        return bot.editMessageText(paymentsMenu.text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: paymentsMenu.reply_markup
        });
    }

    // BACK TO MAIN MENU
    if (data === 'back_to_main') {
        return bot.editMessageText(
            `Protect your privacy with a high-speed VPN built for security, reliability, and ease of use.\n\nPlease choose your country of residence:`,
            {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: mainMenu.reply_markup
            }
        );
    }

        if (data.startsWith('bw_') || data.startsWith('int_bw_')) {
                const isInternational = data.startsWith('int_bw_');
                console.log(`⚡ BW Selection: data=${data}, isInternational=${isInternational}`);
                const bandwidthGb = parseInt(data.replace(isInternational ? 'int_bw_' : 'bw_', ''), 10);

        const bandwidthPrices = {
                40: 1.10,
                50: 1.29,
                70: 1.95,
                100: 2.33,
                300: 5.60,
                500: 9.30,
                1000: 16.99
        };

        if (data.startsWith('wg_bw_') || data.startsWith('int_wg_bw_')) {

           const isInternational = data.startsWith('int_wg_bw_');

           console.log(`⚡ BW Selection: data=${data}, isInternational=${isInternational}`);

           const bandwidthGb = parseInt(
                data.replace(isInternational ? 'int_wg_bw_' : 'wg_bw_', ''),
                10
           );

                const bandwidthPrices = {
                        40: 1.10,
                        50: 1.29,
                        70: 1.95,
                        100: 2.33,
                        300: 5.60,
                        500: 9.30,
                        1000: 16.99
                };

                console.log(`Bandwidth selected: ${bandwidthGb} GB`);
        }
        const requiredAmount = bandwidthPrices[bandwidthGb];
        const session = bot.session?.[userId];

        // Check server selection
        if (!session || !session.selectedServer) {
                await bot.sendMessage(chatId, '❌ Error: No server selected. Please start again.');
                return;
        }

        // 🚦 Application-level lock (per-user)
        if (session.inProgress) {
                await bot.sendMessage(chatId, "⏳ Your request is already being processed. Please wait...");
                return;
        }
        session.inProgress = true;

        const selectedServer = session.selectedServer;

        try {
                const eligible = await checkEligible(userId, chatId, bot);
                const balanceValue = await getUserBalance(userId);

                console.log(`User ${userId} | Eligible: ${eligible} | Balance: $${balanceValue} | Required: $${requiredAmount}`);

                // Not enough balance
                if (!eligible && balanceValue < requiredAmount) {
                        await bot.sendMessage(
                        chatId,
                        `❌ You need at least $${requiredAmount.toFixed(2)} to buy ${bandwidthGb} GB.\nYour current balance: $${balanceValue.toFixed(2)}.\n\nUse /payment to top up.`
                );
                return;
                }

                // VIP info
                if (eligible) {
                        await bot.sendMessage(chatId, `✅ You are on the VIP list! Enjoy exclusive access.`);
                }

                // ✅ Key generation logic
                if (isInternational) {
                        const result = await createInternationalKey(userId, selectedServer, bandwidthGb, 30);
                        await bot.sendMessage(chatId,
                        `✅ Your *International* access key:\n\`${result.key}\`\n🌍 Server: ${result.server}\n⏳ Expires in: ${result.expiresIn} days`,
                        { parse_mode: 'Markdown' }
                        );
                } else {
                        const newKey = await createNewKey(selectedServer, userId, bandwidthGb);
                        await bot.sendMessage(chatId,
                        `✅ Your access key:\n\`${newKey}\``,
                        { parse_mode: 'Markdown' }
                );
                }

                // Deduct for non-VIP
                if (!eligible) {
                        await deductBalance(userId, requiredAmount);
                        await bot.sendMessage(chatId, `💰 $${requiredAmount.toFixed(2)} has been deducted from your balance.`);
                }

        } catch (err) {
                console.error('❌ Error in bandwidth purchase:', err);
                await bot.sendMessage(chatId, `❌ Failed to create key: ${err.message}`);
        } finally {
                // 🔒 Always release lock & cleanup session
                delete bot.session[userId];
        }

        return;
    }


    if (data === 'arena_25gb' || data === 'arena_50gb') {
        const bandwidthGb = data === 'arena_25gb' ? 25 : 50;
        const selectedServer = 'IT01';

        // Define Arena pricing
        const arenaPrices = {
                25: 0.99,  // Adjust these prices as needed
                50: 1.89
        };

        const requiredAmount = arenaPrices[bandwidthGb];

        try {
                const eligible = await Game_Arena_checkEligible(userId, chatId, bot);
                const balanceValue = await getUserBalance(userId); // Should return number like 3.75

                console.log(`Arena | User ${userId} | Eligible: ${eligible} | Balance: $${balanceValue} | Needs: $${requiredAmount}`);

                // Block if not eligible and not enough balance
                if (!eligible && balanceValue < requiredAmount) {
                        await bot.sendMessage(
                        chatId,
                `❌ You need at least $${requiredAmount.toFixed(2)} to get ${bandwidthGb}GB Arena access.\nYour current balance: $${balanceValue.toFixed(2)}.\nUse /payment to top up.`
                );
                        return;
                }

                if (eligible) {
                        await bot.sendMessage(chatId, `✅ You are on the VIP list! Enjoy exclusive Arena access.`);
                }

        // Create the key
                const newKey = await createNewKey(selectedServer, userId, bandwidthGb);
                await bot.sendMessage(chatId, `✅ Your ${bandwidthGb}GB Arena key:\n\`${newKey}\``, { parse_mode: 'Markdown' });

                // Deduct balance only for non-VIP
                if (!eligible) {
                        await deductBalance(userId, requiredAmount);
                        await bot.sendMessage(chatId, `💰 $${requiredAmount.toFixed(2)} has been deducted from your balance.`);
                }

        } catch (err) {
                console.error('❌ Arena purchase error:', err);
                await bot.sendMessage(chatId, `❌ Failed to create Arena key: ${err.message}`);
        }

                return;
        }

    // NOWPAYMENT → DOGECOIN SUBMENUS
    if (data === 'pay_nowpayment') {
        return bot.editMessageText('🪙 Choose a cryptocurrency:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Dogecoin (DOGE)', callback_data: 'pay_doge' }],
                    [{ text: 'Toncoin (Ton)', callback_data: 'pay_ton' }],
                    [{ text: '⬅️ Go Back', callback_data: 'back_to_payment' }]
                ]
            }
        });
    }

    if (data === 'pay_doge') {
        return bot.editMessageText('🔗 Choose the Dogecoin network:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Dogecoin (DOGE)', callback_data: 'doge_network_native' }],
                    [{ text: '⬅️ Go Back', callback_data: 'pay_nowpayment' }]
                ]
            }
        });
    }

    if (data === 'doge_network_native') {
        return bot.editMessageText('💰 Choose the amount to pay in USD:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [
                        //{ text: '$1', callback_data: 'doge_pay_1' },
                        { text: '$3', callback_data: 'doge_pay_3' },
                        { text: '$5', callback_data: 'doge_pay_5' }
                    ],
                    [
                        { text: '$10', callback_data: 'doge_pay_10' },
                        { text: '$20', callback_data: 'doge_pay_20' }
                    ],
                    [
                        { text: '$50', callback_data: 'doge_pay_50' },
                        { text: '$100', callback_data: 'doge_pay_100' }
                    ],
                    [{ text: '⬅️ Go Back', callback_data: 'pay_doge' }]
                ]
            }
        });
    }

    if (data.startsWith('doge_pay_')) {
        const amount = data.replace('doge_pay_', '');
        const currency = 'DOGE';
        console.log('🟡 Received DOGE payment request for amount:', amount);

        try {
                await bot.editMessageText(`🪙 Generating Dogecoin payment session for $${amount}`, {
                chat_id: chatId,
                message_id: messageId
                });
                console.log('🟢 Edited message successfully');

                const result = await createNowPaymentsSession(chatId, amount, currency);
                console.log('🔵 Got NowPayments response:', result);

                if (result && result.payment_url && result.order_id) {
                        const paymentUrl = result.payment_url;
                        const orderId = result.order_id;
                        const paymentId = result.payment_id;
                        console.log('🟣 Using NowPayments OrderID:', orderId);

                        const sql = `
                                INSERT INTO payments (
                                UserID, PaymentDate, PaymentMethod, DigitalCurrencyAmount,
                                Currency, AmountPaidInUSD, CurrentRateToUSD,
                                Status, Comments, OrderID, PaymentID
                                ) VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                        const values = [
                        chatId,                 // UserID
                        'crypto',               // PaymentMethod
                        null,                   // DigitalCurrencyAmount
                        currency,               // Currency: DOGE
                        parseFloat(amount),     // AmountPaidInUSD
                        null,                   // CurrentRateToUSD
                        'waiting',              // Status
                        'DOGE pending payment', // Comments
                        orderId,                 // OrderID
                        paymentId              // ✅ REQUIRED for NowPayments status checks
                        ];

                        try {
                                await db.query(sql, values);
                                console.log('✅ Payment record inserted using NowPayments OrderID');
                        } catch (dbErr) {
                                console.error('❌ Error inserting payment into DB:', dbErr);
                        }

                await bot.sendMessage(chatId, `✅ Click the link below to pay with Dogecoin:\n\n${paymentUrl}`);
                } else {
                        await bot.sendMessage(chatId, '❌ Failed to create payment session. Please try again later.');
                }
        } catch (err) {
                console.error('❌ Error handling Dogecoin payment:', err);
                await bot.sendMessage(chatId, '⚠️ An error occurred while generating your Dogecoin payment link.');
        }
    }




    if (data === 'pay_ton') {
        return bot.editMessageText('🔗 Choose the TON network:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'TON (The Open Network)', callback_data: 'ton_network_native' }],
                [{ text: '⬅️ Go Back', callback_data: 'pay_nowpayment' }]
            ]
        }
        });
    }

    if (data === 'ton_network_native') {
        return bot.editMessageText('💰 Choose the amount to pay in USD:', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                inline_keyboard: [
                        [
                    //{ text: '$1', callback_data: 'ton_pay_1' },
                        { text: '$2', callback_data: 'ton_pay_2' },
                        { text: '$5', callback_data: 'ton_pay_5' }
                        ],
                        [
                        { text: '$10', callback_data: 'ton_pay_10' },
                        { text: '$20', callback_data: 'ton_pay_20' }
                        ],
                        [
                        { text: '$50', callback_data: 'ton_pay_50' },
                        { text: '$100', callback_data: 'ton_pay_100' }
                        ],
                        [{ text: '⬅️ Go Back', callback_data: 'pay_ton' }]
                ]
                }
        });
    }

if (data.startsWith('ton_pay_')) {
    const amount = data.replace('ton_pay_', '');
    const currency = 'TON';
    console.log('🟡 Receieved TON payment request for amount:', amount);

    try {
        await bot.editMessageText(`🪙 Generating TON payment session for $${amount}`, {
            chat_id: chatId,
            message_id: messageId
        });
        console.log('🟢 Edited message successfully');

        // Create payment session
        const result = await createNowPaymentsSession(chatId, amount, currency);
        console.log('🔵 Got NowPayments response:', result);

        // Ensure result contains required fields
        if (result && result.payment_url && result.orderId) {
                const paymentUrl = result.payment_url;
                const orderId = result.orderId;
                const paymentId = result.paymentId;
                const invoiceId = result.invoiceid;
                console.log('� Using NowPayments OrderID:', orderId);

                const sql = `
                        INSERT INTO payments (
                        UserID, PaymentDate, PaymentMethod, DigitalCurrencyAmount,
                        Currency, AmountPaidInUSD, CurrentRateToUSD,
                        Status, Comments, OrderID, PaymentID, invoiceID
                        ) VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                const values = [
                        chatId,                // UserID
                        'crypto',              // PaymentMethod
                        null,                  // DigitalCurrencyAmount (to be updated later)
                        currency,              // Currency: TON
                        parseFloat(amount),    // AmountPaidInUSD
                        null,                  // CurrentRateToUSD (to be updated later)
                        'waiting',             // Status
                        'TON pending payment', // Comments
                        orderId,               // OrderID from NowPayments
                        paymentId,             // PaymentID
                        invoiceId              // invoiceID from NowPayments
                ];


            try {
                await db.query(sql, values);
                console.log('✅ Payment record inserted using NowPayments OrderID');
            } catch (dbErr) {
                console.error('❌ Error inserting payment into DB:', dbErr);
            }

            await bot.sendMessage(chatId, `✅ Click the link below to pay with TON:\n\n${paymentUrl}`);
        } else {
            await bot.sendMessage(chatId, '❌ Failed to create payment session. Please try again later.');
        }

    } catch (err) {
        console.error('❌ Error handling TON payment:', err);
        await bot.sendMessage(chatId, '⚠️ An error occurred while generating your TON payment link.');
    }
}


    if (data === 'back_to_payment') {
        return bot.editMessageText('💳 Please choose a payment method:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Direct (Credit Card)', callback_data: 'pay_direct' }],
                    [{ text: 'Crypto Currency', callback_data: 'pay_nowpayment' }],
                    [{ text: '⬅️ Go Back', callback_data: 'back_to_main' }]
                ]
            }
        });
    }

    // DEFAULT FALLBACK
    return bot.answerCallbackQuery(query.id, {
        text: '✅ Option selected.'
    });
});
