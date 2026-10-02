//main
const axios = require('axios'); //removekey command
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const insertUser = require('./db/insertUser');
const insertVisit = require('./db/insertVisit');
const { createNewKey } = require('./db/KeyCreation');
const { createInternationalKey } = require('./db/KeyCreationInternational');
const { createWireGuardKeys } = require('./db/WGKeyCreation');
const checkBalance = require('./checkBalance');
const { getKeyStatusResponseMessage } = require('./KeyStatus');
const checkEligible = require ('./checkEligibility');
const Game_Arena_checkEligible = require ('./Game_Arena_checkEligibility');
const getUserBalance = require('./db/getUserBalance'); // adjust path as needed
const deductBalance = require('./db/deductBalance');   // same here
const choosePaymentCurrency = require('./db/choosePaymentCurrency'); // Iran menu -> IRC (Rial), International menu -> USD
const { formatMoney } = require('./currency');
const registerReferralMenuCommand = require('./referral_handler');
const registerReferralsReportCommand = require('./referrals_command_handler');
const { creditReferralReward } = require('./db/referral');
const pricing = require('./pricing');                  // all prices + USD/IRC rate live here now
//const { checkBalance, updatePendingPayments } = require('./payments');
//const { updatePendingPayments } = require('./payments');
const db = require('./db');
const mysql = require('mysql');
console.log("✅ MySQL module loaded successfully");
// Crypto top-ups (menus, NowPayments API, automatic payment checking) live in ./payment
const { handlePaymentCallback, startPaymentPoller } = require('./payment');
//const getNowPaymentsInvoiceStatus = require('./getNowPaymentsStatus');
const fs = require('fs');
//const getNowPaymentsInvoiceStatus = require("../getNowPaymentsInvoiceStatus");
const KeyExists = require('./db/keyExists');
const SERVERS = require('./servers'); //removekey command
const https = require('https'); //removekey command
const registerCommands = require('./commands');
const registerAdminCommand = require('./command_Admin');
const registerBroadcastCommand = require('./broadcast_handler');
const registerServerCheckCommand = require('./servercheck_handler');
const registerUsageWarningCommand = require('./usagewarning_handler');
const registerRemoveKeyExpiredCommand = require('./removekeyexpired_handler');
const registerWgRemoveKeysCommands = require('./wgremovekeys_handler');
const registerListUsersCommand = require('./listusers_handler');
const registerUsageWarningInfoCommand = require('./usagewarninginfo_handler');
const registerCheckBalanceCommand = require('./checkbalance_handler');
const registerUserIdUpdateBalanceCommand = require('./useridupdatebalance_handler');
const registerAdminHelpCommand = require('./admin_help_handler');
const registerAddBalanceNotifyCommand = require('./useridaddbalancenotify_handler');
const registerLastKeysCommand = require('./lastkeys_handler');
const registerListBlockedCommand = require('./listblocked_handler');
const registerTestServerCommand = require('./testserver_handler');
const registerWGTestServerCommand = require('./WGtestserver_handler');
const registerWGTestServerIranCommand = require('./WGtestserveriran_handler');
const registerAvailableServersCommand = require('./availableserversoutline_handler');
const registerAvailableServersWGCommand = require('./availableserverswg_handler');

let callbackToServer = {};
let callbackToInternationalServer = {};


const { TELEGRAM_BOT_TOKEN } = require('./token');


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

// Hard-coded per your instruction — mirrors the Outline callbackToServer pattern,
// but static instead of config-file-driven since alias choice (Ger27 vs Ger28, etc.)
// is a deliberate ops decision, not something to load-balance automatically.
const WG_COUNTRY_TO_ALIAS = {
    ger: 'Ger28',
    sweden: 'S84',  // TODO: fill in
    // fin: 'XXX',
    ca: 'Ca01',
    it: 'IT01',
    // nig: 'XXX',
    // tur: 'XXX',
    // in: 'XXX',
    // eg: 'XXX',
    tha: 'Thai02',
    uk: 'UK42',
     usa: 'US08',
};

// Price tables moved to ./pricing.js (USD + IRC). Iran menus show IRC (Rial) prices.

/**
 * Usage: const menu = buildWgTrafficMenu(2);   // 2 devices
 *        bot.editMessageText(menu.text, { chat_id, message_id, reply_markup: menu.reply_markup });
 * WireGuard is only reachable from the Iran menu, so labels are in IRC (Rial).
 */
function buildWgTrafficMenu(deviceCount) {
    const buttons = pricing.WG_GB_OPTIONS.map(gb => {
        const total = pricing.getWgPrice(gb, deviceCount, 'IRC');
        return [{ text: `${gb} GB / ${formatMoney('IRC', total)}`, callback_data: `wg_bw_${gb}` }];
    });
    buttons.push([{ text: '⬅️ Go Back', callback_data: 'sub_wg_number_user' }]);

    return {
        text: `Select your 30-day WireGuard traffic package (${deviceCount} device${deviceCount > 1 ? 's' : ''}):`,
        reply_markup: { inline_keyboard: buttons }
    };
}

/**
 * Usage: const menu = buildIranOutlineMenu();
 *        bot.editMessageText(menu.text, { chat_id, message_id, reply_markup: menu.reply_markup });
 * Iran Outline bandwidth menu with IRC (Rial) prices. Same callback_data
 * ('bw_<GB>') as before, so the purchase handler is found the same way.
 */
function buildIranOutlineMenu() {
    const buttons = pricing.IRAN_OUTLINE_GBS.map(gb => (
        [{ text: `${gb} GB / ${formatMoney('IRC', pricing.getOutlinePrice(gb, 'IRC'))}`, callback_data: `bw_${gb}` }]
    ));
    buttons.push([{ text: '⬅️ Go Back', callback_data: 'sub_1_speed' }]);

    return {
        text: 'Select the 30-day Outline bandwidth limit:',
        reply_markup: { inline_keyboard: buttons }
    };
}

const waitingForKey = new Set();

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
//const bot = new TelegramBot(token, {
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

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
                    //{ text: 'Sweden 🇸🇪', callback_data: 'wg_speed_sweden' }
                    { text: 'UK 🇬🇧 ', callback_data: 'wg_speed_uk' }
                ],
/*                [
                    { text: 'Thailand 🇹🇭 ', callback_data: 'wg_speed_tha' },
                    //{ text: 'Iran 🇮🇷', callback_data: 'speed_ir' }
                    { text: 'Italy 🇮🇹 ', callback_data: 'wg_speed_it' }
                ],
                [
                    { text: 'Nigeria 🇳🇬 ', callback_data: 'wg_speed_nig' },
                    { text: 'Turkey 🇹🇷 ', callback_data: 'wg_speed_tur' }
                ],
                //[
                  //  { text: 'India 🇮🇳', callback_data: 'wg_speed_in' },
                   // { text: 'Egypt 🇪🇬 ' , callback_data: 'wg_speed_eg' }
                //],
                [
                    { text: 'UK 🇬🇧 ', callback_data: 'wg_speed_uk' },
                    { text: 'USA 🇺🇸', callback_data: 'wg_speed_usa' }
                ],
  */              [{ text: '⬅️ Go Back', callback_data: 'sub_Outline_VS_WireGuard' }]
            ]
        }
    },
    sub_wg_number_user: {
        text: 'Please choose the number of devices: ',
        reply_markup: {
           inline_keyboard: [
                [{ text: '1 device', callback_data: 'wg_number_one_devices' }],
                [{ text: `2 devices + ${formatMoney('IRC', pricing.getWgExtraDeviceFee('IRC'))}`, callback_data: 'wg_number_two_devices' }],
                [{ text: `3 devices + ${formatMoney('IRC', 2 * pricing.getWgExtraDeviceFee('IRC'))}`, callback_data: 'wg_number_three_devices' }],
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
                  [{ text: '⬅️ Go Back', callback_data: 'sub_wg_number_user' }]
             ]
         }
      },

    sub_1_game: {
        text: '  Choose a game-optimized server for smoother, faster gameplay:',
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
                        [{ text: `25 GB – ${formatMoney('IRC', pricing.getArenaPrice(25, 'IRC'))}`, callback_data: 'arena_25gb' }],
                        [{ text: `50 GB – ${formatMoney('IRC', pricing.getArenaPrice(50, 'IRC'))}`, callback_data: 'arena_50gb' }],
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
                    //{ text: 'Finland 🇫🇮 ', callback_data: 'speed_fin' },
                    { text: 'Canada 🇨🇦 ', callback_data: 'speed_canada'},
                    //{ text: 'Iran 🇮🇷', callback_data: 'speed_ir' }
                    { text: 'Italy 🇮🇹 ', callback_data: 'speed_it' }
                ],
                [
                    { text: 'Nigeria 🇳🇬 ', callback_data: 'speed_nig' },
                    { text: 'Pakistan 🇵🇰 ', callback_data: 'speed_pak' }
                ],
                //[
                    //{ text: 'India 🇮🇳', callback_data: 'speed_in' },
                    //{ text: 'Egypt 🇪🇬 ' , callback_data: 'speed_eg' }
                //],
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
                [{ text: '20 GB / 1.99 USD', callback_data: 'bw_20' }],
                [{ text: '40 GB / 2.19 USD', callback_data: 'bw_40' }],
                [{ text: '50 GB / 2.29 USD', callback_data: 'bw_50' }],
                [{ text: '70 GB / 2.79 USD', callback_data: 'bw_70' }],
                [{ text: '100 GB / 3.29 USD', callback_data: 'bw_100' }],
                [{ text: '300 GB / 6.49 USD', callback_data: 'bw_300' }],
                //[{ text: '500 GB / 9.30 USD', callback_data: 'bw_500' }],
                //[{ text: '1000 GB / 16.99 USD', callback_data: 'bw_1000' }],
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

// ---------------------------------------------------------------------------
// All slash-command handlers (/start, /payment, /userid, /balance,
// /ks, /userbalance*, /sendMessage, /keyusername, /keyuserid,
// /expiredkeys*, /removekey, /updatekey, /hc) plus the generic
// message-forwarding handler now live in ./commands.js
// ---------------------------------------------------------------------------
registerCommands(bot, {
    db,
    insertUser,
    insertVisit,
    getKeyStatusResponseMessage,
    KeyExists,
    SERVERS,
    axios,
    https,
    mainMenu,
    waitingForKey
});
// Checks open crypto payments in the background and notifies users automatically
startPaymentPoller(bot, db);
registerAdminCommand(bot, { db });
registerBroadcastCommand(bot, { db });
registerServerCheckCommand(bot, { db, SERVERS, axios, https });
registerUsageWarningCommand(bot, { db, SERVERS, axios, https });
registerRemoveKeyExpiredCommand(bot, { db, SERVERS, axios, https });
registerWgRemoveKeysCommands(bot, { db, axios });
registerListUsersCommand(bot, { db });
registerUsageWarningInfoCommand(bot, { db, SERVERS, axios, https });
registerCheckBalanceCommand(bot, { db });
registerUserIdUpdateBalanceCommand(bot, { db });
registerAdminHelpCommand(bot, { db });
registerAddBalanceNotifyCommand(bot, { db });
registerLastKeysCommand(bot, { db, SERVERS, axios, https });
registerListBlockedCommand(bot, { db });
registerTestServerCommand(bot, { db, SERVERS, createNewKey });


registerAvailableServersCommand(bot, { db, SERVERS });
registerWGTestServerCommand(bot, { db, createWireGuardKeys });
registerWGTestServerIranCommand(bot, { db, createWireGuardKeys });
registerAvailableServersWGCommand(bot, { db });

// registerReferralMenuCommand MUST be called AFTER registerCommands (above,
// where commands.js sets up its own bot.on('message') listener).
// commands.js checks waitingForReferralCode to avoid forwarding a typed
// invite code to the admin; that check only works if it runs BEFORE
// referral_handler.js's own message listener deletes the chat from that
// set. Node's EventEmitter calls 'message' listeners synchronously in
// registration order, so registering commands.js first is what makes
// this safe — moving this line earlier would reintroduce the leak.
registerReferralMenuCommand(bot, { db });
registerReferralsReportCommand(bot, { db });

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const userId = query.from.id;
    //console.log(`[TRACE] User=${userId} | Data=${data}`);

    // /payment flow (Direct / Crypto menus, payment creation) -> ./payment/menus.js
    if (await handlePaymentCallback(bot, query, { db })) return;

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

        const bandwidthMenu = buildIranOutlineMenu();   // IRC (Rial) prices
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
                // Iran menu pays from the IRC (Rial) wallet, International menu from USD.
                const preferredCurrency = isInternational ? 'USD' : 'IRC';
                console.log(`⚡ BW Selection: data=${data}, isInternational=${isInternational}, currency=${preferredCurrency}`);
                const bandwidthGb = parseInt(data.replace(isInternational ? 'int_bw_' : 'bw_', ''), 10);

        const prices = {
                USD: pricing.getOutlinePrice(bandwidthGb, 'USD'),
                IRC: pricing.getOutlinePrice(bandwidthGb, 'IRC')
        };
        if (!prices[preferredCurrency]) {
                await bot.sendMessage(chatId, '❌ Invalid bandwidth selection.');
                return;
        }
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
                const payment = await choosePaymentCurrency(userId, prices, preferredCurrency);

                console.log(`User ${userId} | Eligible: ${eligible} | Pay with: ${payment.currency} | Balances: ${JSON.stringify(payment.balances)} | Prices: ${JSON.stringify(prices)}`);

                // Not enough balance
                if (!eligible && !payment.currency) {
                        await bot.sendMessage(
                        chatId,
                        pricing.insufficientFundsText({ preferred: preferredCurrency, prices, balances: payment.balances, what: `${bandwidthGb} GB` })
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

                // Deduct for non-VIP (from the wallet choosePaymentCurrency picked)
                if (!eligible) {
                        await deductBalance(userId, payment.amount, payment.currency);
                        await bot.sendMessage(chatId, `💰 ${formatMoney(payment.currency, payment.amount)} has been deducted from your balance.`);
                        await creditReferralReward(db, bot, userId, payment.currency, payment.amount, 'Outline');
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

        // Arena is only reachable from the Iran menu -> pays from IRC (Rial), USD fallback.
        const prices = {
                IRC: pricing.getArenaPrice(bandwidthGb, 'IRC'),
                USD: pricing.getArenaPrice(bandwidthGb, 'USD')
        };

        try {
                const eligible = await Game_Arena_checkEligible(userId, chatId, bot);
                const payment = await choosePaymentCurrency(userId, prices, 'IRC');

                console.log(`Arena | User ${userId} | Eligible: ${eligible} | Pay with: ${payment.currency} | Balances: ${JSON.stringify(payment.balances)} | Prices: ${JSON.stringify(prices)}`);

                // Block if not eligible and not enough balance
                if (!eligible && !payment.currency) {
                        await bot.sendMessage(
                        chatId,
                        pricing.insufficientFundsText({ preferred: 'IRC', prices, balances: payment.balances, what: `${bandwidthGb}GB Arena access` })
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
                        await deductBalance(userId, payment.amount, payment.currency);
                        await bot.sendMessage(chatId, `💰 ${formatMoney(payment.currency, payment.amount)} has been deducted from your balance.`);
                        await creditReferralReward(db, bot, userId, payment.currency, payment.amount, 'Arena');
                }

        } catch (err) {
                console.error('❌ Arena purchase error:', err);
                await bot.sendMessage(chatId, `❌ Failed to create Arena key: ${err.message}`);
        }

                return;
        }

    if (data.startsWith('wg_speed_')) {

        bot.session ??= {};
        bot.session[userId] ??= {};

        bot.session[userId].vpnType = 'wireguard';
        bot.session[userId].country =
        data.replace('wg_speed_', '');
        // TEMPORARY: PublicURLIran isn't set up for WireGuard yet — always use
        // PublicURLInternational for now. Switch this back to menu-based logic
        // once PublicURLIran is properly configured for WG servers.
        bot.session[userId].isInternational = true;

        return bot.editMessageText(
                subMenus.sub_wg_number_user.text,
                {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: subMenus.sub_wg_number_user.reply_markup
                }
        );
    }

    if (data.startsWith('wg_number_')) {

        const devicesMap = {
                wg_number_one_devices: 1,
                wg_number_two_devices: 2,
                wg_number_three_devices: 3
        };
if (!bot.session[userId]) {
    bot.session[userId] = {};
}
bot.session[userId].devices = devicesMap[data];
        //bot.session[userId].devices = devicesMap[data];

        const trafficMenu = buildWgTrafficMenu(bot.session[userId].devices);

        return bot.editMessageText(trafficMenu.text, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: trafficMenu.reply_markup
        });
    }

if (data.startsWith('wg_bw_')) {
    const bandwidth = parseInt(data.replace('wg_bw_', ''), 10);
    const session = bot.session?.[userId];

    if (!session || !session.country || !session.devices) {
        await bot.sendMessage(chatId, '❌ Session expired. Please start again.');
        return;
    }

    if (session.inProgress) {
        await bot.sendMessage(chatId, '⏳ Your request is already being processed. Please wait...');
        return;
    }
    session.inProgress = true;

    // WireGuard is only reachable from the Iran menu -> pays from IRC (Rial), USD fallback.
    const prices = {
        IRC: pricing.getWgPrice(bandwidth, session.devices, 'IRC'),
        USD: pricing.getWgPrice(bandwidth, session.devices, 'USD')
    };
    const requiredAmount = prices.IRC;
    if (!requiredAmount) {
        await bot.sendMessage(chatId, '❌ Invalid bandwidth selection.');
        delete bot.session[userId];
        return;
    }

    const serverAlias = WG_COUNTRY_TO_ALIAS[session.country];
    if (!serverAlias) {
        await bot.sendMessage(chatId, `❌ No server configured for country: ${session.country}`);
        delete bot.session[userId];
        return;
    }

    try {
        const eligible = await checkEligible(userId, chatId, bot);
        const payment = await choosePaymentCurrency(userId, prices, 'IRC');

        console.log(`WG | User ${userId} | Country: ${session.country} | Devices: ${session.devices} | BW: ${bandwidth}GB | Pay with: ${payment.currency} | Balances: ${JSON.stringify(payment.balances)} | Prices: ${JSON.stringify(prices)}`);

        if (!eligible && !payment.currency) {
            await bot.sendMessage(
                chatId,
                pricing.insufficientFundsText({ preferred: 'IRC', prices, balances: payment.balances, what: `${bandwidth} GB` })
            );
            return;
        }

        if (eligible) {
            await bot.sendMessage(chatId, `✅ You are on the VIP list! Enjoy exclusive access.`);
        }

        const { createWireGuardKeys } = require('./db/WGKeyCreation');
        const peers = await createWireGuardKeys({
            serverAlias,
            userId,
            deviceCount:     session.devices,
            bandwidthGb:     bandwidth,
            isInternational: false,   // ← uses PublicURLIran
            validDays:       30
        });

        /**
         * Sends each peer's config as ONE Telegram message: a caption with
         * a tap-to-copy "#<name>" header (backticks = Telegram's inline
         * code, which renders with the same copy affordance as the ```
         * config block below it) plus the flag emoji, and the same config
         * attached as a downloadable "<fileName>.conf" file. The
         * caption's name can be anything (it's just chat text), but the
         * attached filename MUST be <=15 chars, [a-zA-Z0-9_=+.-] only —
         * that's what the WireGuard apps turn into the tunnel's interface
         * name on import, and anything else (emoji, '#', longer strings)
         * fails to import. See buildFileName() in WGKeyCreation.js.
         *
         * Usage: called once per peer immediately after
         * createWireGuardKeys() resolves, inside the wg_bw_ handler above.
         *
         * Note: Telegram caption limit is 1024 chars (vs 4096 for a plain
         * text message) — fine for a normal WG config, but keep an eye on
         * it if configs ever grow (extra DNS entries, etc).
         */
        for (const peer of peers) {
            const caption =
                `✅ *WireGuard Config (Device ${peer.deviceSeq}/${session.devices})*\n\n` +
                `\`#${peer.name}\`\n\n` +
                `\`\`\`\n${peer.config}\n\`\`\``;

            await bot.sendDocument(
                chatId,
                Buffer.from(peer.config, 'utf8'),
                {
                    caption,
                    parse_mode: 'Markdown'
                },
                {
                    filename: `${peer.fileName}.conf`,
                    contentType: 'text/plain'
                }
            );
        }

        if (!eligible) {
            await deductBalance(userId, payment.amount, payment.currency);
            await bot.sendMessage(chatId, `💰 ${formatMoney(payment.currency, payment.amount)} has been deducted from your balance.`);
            await creditReferralReward(db, bot, userId, payment.currency, payment.amount, 'WireGuard');
        }

    } catch (err) {
        console.error('❌ WireGuard purchase error:', err);
        await bot.sendMessage(chatId, `❌ Failed to create WireGuard key: ${err.message}`);
    } finally {
        delete bot.session[userId];
    }

    return;
}

    // DEFAULT FALLBACK
    return bot.answerCallbackQuery(query.id, {
        text: '✅ Option selected.'
    });
});

