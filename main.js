//main
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const insertUser = require('./db/insertUser');
const insertVisit = require('./db/insertVisit');
const { createNewKey } = require('./db/KeyCreation');
const checkBalance = require('./checkBalance');
const { getKeyStatusResponseMessage } = require('./KeyStatus');
const checkEligible = require ('./checkEligibility');
const Game_Arena_checkEligible = require ('./Game_Arena_checkEligibility');
//const webhookRoutes = require('./webhook');
const getUserBalance = require('./db/getUserBalance'); // adjust path as needed
const deductBalance = require('./db/deductBalance');   // same here


//const token = '';
const token = '';
//const { TELEGRAM_BOT_TOKEN } = require('./token');
const { NOWPAYMENTS_API_KEY } = require('./token');
//const NOWPAYMENTS_API_KEY = '';

const createNowPaymentsSession = require('./createNowPaymentsSession');

//const app = express();
//app.use(express.json());
//app.use('/', webhookRoutes);


const { paymentsMenu, paymentsSubMenus } = require('./payments');
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
            [{ text: 'Russia🇷🇺', callback_data: 'menu_1' }],
            [{ text: 'International 🌐', callback_data: 'sub_INT_speed' }]
        ]
    }
};

const subMenus = {
    menu_1: {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Game', callback_data: 'sub_1_game' }],
                [{ text: 'High Speed', callback_data: 'sub_1_speed' }],
                [{ text: '⬅️ Go Back', callback_data: 'back_to_main' }]
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
                    { text: 'Germany (soon)', callback_data: 'speed_ger' },
                    { text: 'Sweden', callback_data: 'speed_sweden' }
                ],
                [
                    { text: 'Spain', callback_data: 'speed_sp' },
                    { text: 'Iran', callback_data: 'speed_ir' }
                ],
                [
                    { text: 'Italy', callback_data: 'speed_it' },
                    { text: 'Turkey', callback_data: 'speed_tur' }
                ],
                [
                    { text: 'USA', callback_data: 'speed_usa' },
                    { text: 'UK', callback_data: 'speed_uk' }
                ],
                [{ text: '⬅️ Go Back', callback_data: 'menu_1' }]
            ]
        }
    },
    bandwidth_menu: {
        text: 'Select the 30-day Outline bandwidth limit:',
        reply_markup: {
            inline_keyboard: [
                [{ text: '50 GB / 1.29 USD', callback_data: 'bw_50' }],
                [{ text: '100 GB / 2.33 USD', callback_data: 'bw_100' }],
                [{ text: '300 GB / 5.60 USD', callback_data: 'bw_300' }],
                [{ text: '500 GB / 9.30 USD', callback_data: 'bw_500' }],
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
        text: '⚡ Choose a high-speed location for fast and secure internet:',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Germany (soon)', callback_data: 'speed_ger' },
                    { text: 'Sweden', callback_data: 'speed_sweden' }
                ],
                [
                    { text: 'Spain', callback_data: 'speed_sp' },
                    { text: 'Iran', callback_data: 'speed_ir' }
                ],
                [
                    { text: 'Italy', callback_data: 'speed_it' },
                    { text: 'Turkey', callback_data: 'speed_tur' }
                ],
                [
                    { text: 'USA', callback_data: 'speed_usa' },
                    { text: 'UK', callback_data: 'speed_uk' }
                ],
                [{ text: '⬅️ Go Back', callback_data: 'back_to_main' }]
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

bot.onText(/\/userid/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || 'No username';
    const firstName = msg.from.first_name || '';
    const lastName = msg.from.last_name || '';

    const message = `👤 *User Information*\n\n` +
    `🆔 *User ID:* \`${userId}\`\n` +
    `🔖 *Username:* @${username}\n` +
    `📛 *Full Name:* ${firstName} ${lastName}`.trim();

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/payment/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId, '💳 Please choose a payment method:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Direct (Credit Card)', callback_data: 'pay_direct' }],
                [{ text: 'Digital Currency', callback_data: 'pay_nowpayment' }],
                [{ text: '⬅️ Go Back', callback_data: 'back_to_main' }]
            ]
        }
    });
});



bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const balance = await checkBalance(userId);
    if (balance === null) {
      await bot.sendMessage(chatId, '⚠️ Your account was not found.');
    } else {
      await bot.sendMessage(chatId, 
  `💰 *Your Current Balance:* \`${balance} USD\`\n\nTo make a payment, simply type /payment or select it from the menu below.`,
  {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Go Back', callback_data: 'back_to_main' }]
      ]
    }
  }
);

    }
  } catch (err) {
    await bot.sendMessage(chatId, '❌ An error occurred while checking your balance.');
    console.error('Balance check error:', err);
  }
});


bot.onText(/\/KeyStatus/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '� Please send me your key now:');
    waitingForKey.add(chatId);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    if (!text || text.startsWith('/KeyStatus')) return;

    if (waitingForKey.has(chatId)) {
        waitingForKey.delete(chatId);
        try {
            const result = await getKeyStatusResponseMessage(text);
            bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(chatId, `❌ Error: ${err.message}`);
        }
    }
});

const callbackToServer = {
    speed_ger: 'Ger',
    speed_sweden: 'Sw84',
    speed_sp: 'Sp01',
    speed_ir: 'IRAN',
    speed_it: 'IT01',
    speed_tur: 'Tur14',
    speed_usa: 'US08',
    speed_uk: 'UK37'
};
/*
const bandwidthPrices = {
    50: 1.29,
    100: 2.33,
    300: 5.60,
    500: 9.30,
    1000: 16.99
};
*/
    	
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const userId = query.from.id;

    // SESSION SETUP FOR BANDWIDTH MENU
    const bandwidthCountries = ['speed_sweden', 'speed_sp', 'speed_it', 'speed_tur', 'speed_usa', 'speed_uk'];
    if (bandwidthCountries.includes(data)) {
        const selectedServer = callbackToServer[data];
        bot.session = bot.session || {};
        bot.session[userId] = { selectedServer };

        const bandwidthMenu = subMenus.bandwidth_menu;
        return bot.editMessageText(bandwidthMenu.text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: bandwidthMenu.reply_markup
        });
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

    // SPECIFIC PAYMENT SUBMENUS
    if (paymentsSubMenus[data]) {
        const submenu = paymentsSubMenus[data];
        return bot.editMessageText(submenu.text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: submenu.reply_markup
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


if (data.startsWith('bw_')) {
    const bandwidthGb = parseInt(data.replace('bw_', ''), 10);

    const bandwidthPrices = {
        50: 1.29,
        100: 2.33,
        300: 5.60,
        500: 9.30,
        1000: 16.99
    };

    const requiredAmount = bandwidthPrices[bandwidthGb];
    const session = bot.session?.[userId];

    if (!session || !session.selectedServer) {
        await bot.sendMessage(chatId, '❌ Error: No server selected. Please start again.');
        return;
    }

    const selectedServer = session.selectedServer;

    try {
        const eligible = await checkEligible(userId, chatId, bot);
        const balanceValue = await getUserBalance(userId); // Should return number (e.g. 3.50)

        console.log(`User ${userId} | Eligible: ${eligible} | Balance: $${balanceValue} | Required: $${requiredAmount}`);

        // Block if not VIP and not enough balance
        if (!eligible && balanceValue < requiredAmount) {
            await bot.sendMessage(
                chatId,
                `❌ You need at least $${requiredAmount.toFixed(2)} to buy ${bandwidthGb} GB.\nYour current balance: $${balanceValue.toFixed(2)}.\n\nUse /payment to top up.`
            );
            return;
        }

        // Inform VIP users
        if (eligible) {
            await bot.sendMessage(chatId, `✅ You are on the VIP list! Enjoy exclusive access.`);
        }

        // Create key
        const newKey = await createNewKey(selectedServer, userId, bandwidthGb);
        await bot.sendMessage(chatId, `✅ Your access key:\n\`${newKey}\``, { parse_mode: 'Markdown' });

        // Deduct balance only for non-VIP
        if (!eligible) {
            await deductBalance(userId, requiredAmount);
            await bot.sendMessage(chatId, `💰 $${requiredAmount.toFixed(2)} has been deducted from your balance.`);
        }

    } catch (err) {
        console.error('❌ Error in bandwidth purchase:', err);
        await bot.sendMessage(chatId, `❌ Failed to create key: ${err.message}`);
    }

    // Cleanup
    delete bot.session[userId];
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
                        { text: '$2', callback_data: 'doge_pay_2' },
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

        try {
            // Edit the original message
            await bot.editMessageText(`🪙 Generating Dogecoin payment session for $${amount}`, {
                chat_id: chatId,
                message_id: messageId
            });

            // Generate payment session
            const paymentUrl = await createNowPaymentsSession(chatId, amount, currency);

            if (paymentUrl) {
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

    	try {
        // Edit the original message
        	await bot.editMessageText(`🪙 Generating TON payment session for $${amount}`, {
            	chat_id: chatId,
            	message_id: messageId
        	});

        // Generate payment session
        	const paymentUrl = await createNowPaymentsSession(chatId, amount, currency);

        	if (paymentUrl) {
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
                    [{ text: 'Digital Currency', callback_data: 'pay_nowpayment' }],
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

// Start Express server
//app.listen(3000, () => {
    //console.log('� Express server running on port 3000');
//});
