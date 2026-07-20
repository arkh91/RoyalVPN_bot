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
const registerCommands = require('./commands');
const registerAdminCommand = require('./command_Admin');
const registerBroadcastCommand = require('./broadcast_handler');
const registerServerCheckCommand = require('./servercheck_handler');

let callbackToServer = {};
let callbackToInternationalServer = {};


const { TELEGRAM_BOT_TOKEN } = require('./token');
const { NOWPAYMENTS_API_KEY } = require('./token');

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

// Hard-coded per your instruction — mirrors the Outline callbackToServer pattern,
// but static instead of config-file-driven since alias choice (Ger27 vs Ger28, etc.)
// is a deliberate ops decision, not something to load-balance automatically.
const WG_COUNTRY_TO_ALIAS = {
    ger: 'Ger27',
    sweden: 'S84',  // TODO: fill in
    // fin: 'XXX',
    it: 'IT01',
    // nig: 'XXX',
    // tur: 'XXX',
    // in: 'XXX',
    // eg: 'XXX',
    tha: 'Thai02',
    // uk: 'XXX',
     usa: 'US08',
};

const WG_BASE_BANDWIDTH_PRICES = {
    40: 1.10,
    50: 1.29,
    70: 1.95,
    100: 2.33,
    300: 5.60,
    1000: 16.99
};

// Total price = base (1 device) + $1.00 for each additional device.
function getWgPrice(bandwidthGb, deviceCount) {
    const base = WG_BASE_BANDWIDTH_PRICES[bandwidthGb];
    return base + (deviceCount - 1) * 1.00;
}

function buildWgTrafficMenu(deviceCount) {
    const buttons = Object.keys(WG_BASE_BANDWIDTH_PRICES).map(gb => {
        const total = getWgPrice(Number(gb), deviceCount);
        return [{ text: `${gb} GB / ${total.toFixed(2)} USD`, callback_data: `wg_bw_${gb}` }];
    });
    buttons.push([{ text: '⬅️ Go Back', callback_data: 'sub_wg_number_user' }]);

    return {
        text: `Select your 30-day WireGuard traffic package (${deviceCount} device${deviceCount > 1 ? 's' : ''}):`,
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
                    { text: 'Sweden 🇸🇪', callback_data: 'wg_speed_sweden' }
                ],
                [
                    { text: 'Thailand 🇹🇭 ', callback_data: 'wg_speed_tha' },
                    //{ text: 'Iran 🇮🇷', callback_data: 'speed_ir' }
                    { text: 'Italy 🇮🇹 ', callback_data: 'wg_speed_it' }
                ],
                //[
                    //{ text: 'Nigeria 🇳🇬 ', callback_data: 'wg_speed_nig' },
                    //{ text: 'Turkey 🇹🇷 ', callback_data: 'wg_speed_tur' }
                //],
                //[
                  //  { text: 'India 🇮🇳', callback_data: 'wg_speed_in' },
                   // { text: 'Egypt 🇪🇬 ' , callback_data: 'wg_speed_eg' }
                //],
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
                [{ text: '2 devices + $1', callback_data: 'wg_number_two_devices' }],
                [{ text: '3 devices + $2', callback_data: 'wg_number_three_devices' }],
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
                    //{ text: 'Finland 🇫🇮 ', callback_data: 'speed_fin' },
                    { text: 'Thailand 🇹🇭 ', callback_data: 'speed_thailand'},
                    //{ text: 'Iran 🇮🇷', callback_data: 'speed_ir' }
                    { text: 'Italy 🇮🇹 ', callback_data: 'speed_it' }
                ],
                //[
                    //{ text: 'Nigeria 🇳🇬 ', callback_data: 'speed_nig' },
                    //{ text: 'Turkey 🇹🇷 ', callback_data: 'speed_tur' }
                //],
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
                [{ text: '20 GB / 0.99 USD', callback_data: 'bw_20' }],
                [{ text: '40 GB / 1.19 USD', callback_data: 'bw_40' }],
                [{ text: '50 GB / 1.29 USD', callback_data: 'bw_50' }],
                [{ text: '70 GB / 1.79 USD', callback_data: 'bw_70' }],
                [{ text: '100 GB / 2.29 USD', callback_data: 'bw_100' }],
                [{ text: '300 GB / 5.49 USD', callback_data: 'bw_300' }],
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
    getNowPaymentsInvoiceStatus,
    KeyExists,
    SERVERS,
    axios,
    https,
    mainMenu,
    waitingForKey
});
registerAdminCommand(bot, { db });
registerBroadcastCommand(bot, { db });
registerServerCheckCommand(bot, { db, SERVERS, axios, https });

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
                20: 0.99,
                40: 1.19,
                50: 1.29,
                70: 1.79,
                100: 2.29,
                300: 5.49,
                500: 9.30,
                1000: 16.99
        };

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

    //const requiredAmount = WG_BASE_BANDWIDTH_PRICES[bandwidth];
        const EXTRA_DEVICE_FEE = 1.00;
//const requiredAmount = WG_BASE_BANDWIDTH_PRICES[bandwidth] + (session.devices - 1) * EXTRA_DEVICE_FEE;

const requiredAmount = Math.round(
    (WG_BASE_BANDWIDTH_PRICES[bandwidth] + (session.devices - 1) * EXTRA_DEVICE_FEE) * 100
) / 100;
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
        const balanceValue = await getUserBalance(userId);

        console.log(`WG | User ${userId} | Country: ${session.country} | Devices: ${session.devices} | BW: ${bandwidth}GB | Balance: $${balanceValue} | Required: $${requiredAmount}`);

        if (!eligible && balanceValue < requiredAmount) {
            await bot.sendMessage(
                chatId,
                `❌ You need at least $${requiredAmount.toFixed(2)} to buy ${bandwidth} GB.\nYour current balance: $${balanceValue.toFixed(2)}.\n\nUse /payment to top up.`
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

        for (const peer of peers) {
            await bot.sendMessage(
                chatId,
                `✅ *WireGuard Config (Device ${peer.deviceSeq}/${session.devices})*\n\n\`\`\`\n${peer.config}\n\`\`\``,
                { parse_mode: 'Markdown' }
            );
        }

        if (!eligible) {
            await deductBalance(userId, requiredAmount);
            await bot.sendMessage(chatId, `💰 $${requiredAmount.toFixed(2)} has been deducted from your balance.`);
        }

    } catch (err) {
        console.error('❌ WireGuard purchase error:', err);
        await bot.sendMessage(chatId, `❌ Failed to create WireGuard key: ${err.message}`);
    } finally {
        delete bot.session[userId];
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
                console.log('  Using NowPayments OrderID:', orderId);

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
