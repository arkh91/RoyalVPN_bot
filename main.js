const TelegramBot = require('node-telegram-bot-api');
const insertUser = require('./db/insertUser');
const insertVisit = require('./db/insertVisit');
const { createNewKey } = require('./db/KeyCreation');
const checkBalance = require('./checkBalance');
const { getKeyStatusResponseMessage } = require('./KeyStatus');
const checkEligible = require ('./checkEligibility');

const token = '';


const { paymentsMenu, paymentsSubMenus } = require('./payments');
const waitingForKey = new Set();

const bot = new TelegramBot(token, {
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
            [{ text: 'Russia🇷🇺', callback_data: 'menu_1' }],
            [{ text: 'India🇮🇳', callback_data: 'menu_1' }]
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
                [{ text: '50 GB / 0.99 USD', callback_data: 'bw_50' }],
                [{ text: '100 GB / 1.99 USD', callback_data: 'bw_100' }],
                [{ text: '300 GB / 5.99 USD', callback_data: 'bw_300' }],
                [{ text: '500 GB / 9.99 USD', callback_data: 'bw_500' }],
                [{ text: '1000 GB / 19.99 USD', callback_data: 'bw_1000' }],
                [{ text: '⬅️ Go Back', callback_data: 'sub_1_speed' }]
            ]
        }
    }
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
    bot.sendMessage(chatId, '� This section is under development.', {
        reply_markup: {
            inline_keyboard: [[{ text: '� Go Back', callback_data: 'back_to_main' }]]
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
    speed_sweden: 'Sweden82',
    speed_sp: 'Spain',
    speed_ir: 'IRAN',
    speed_it: 'IT01',
    speed_tur: 'TUR14',
    speed_usa: 'US08',
    speed_uk: 'UK36'
};

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const userId = query.message.from.id;

    const bandwidthCountries = ['speed_sweden', 'speed_sp', 'speed_it', 'speed_tur', 'speed_usa', 'speed_uk'];
    if (bandwidthCountries.includes(data)) {
        const selectedServer = callbackToServer[data];
        bot.session = bot.session || {};
        bot.session[userId] = { selectedServer };

//        const hasBalance = await checkBalance(userId);
//	const eligible = await checkEligible(userId);
/*
        if (!hasBalance) {
            bot.sendMessage(chatId, `❌ You do not have enough balance. Please use /payment to top up.`);
            return;
	}
	if (eligible){
	   bot.sendMessage(chatId, `✅ You are on the VIP list! Enjoy exclusive access.`);
	}
*/

	/*    
	if (eligible) {
    bot.sendMessage(chatId, `✅ You are on the VIP list! Enjoy exclusive access.`);
} else if(!hasBalance) {
    bot.sendMessage(chatId, `❌ You do not have enough balance. Please use /payment to top up.`);
    return; // Stop execution here — no access key is sent
}*/

	    /*
	if (eligible) {
    bot.sendMessage(chatId, `✅ You are on the VIP list! Enjoy exclusive access.`);
} else if (!hasBalance) {
    bot.sendMessage(chatId, `❌ You do not have enough balance. Please use /payment to top up.`);
}*/


        const bandwidthMenu = subMenus.bandwidth_menu;
        bot.editMessageText(bandwidthMenu.text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: bandwidthMenu.reply_markup
        });
        return;
    }

    if (subMenus[data]) {
        const submenu = subMenus[data];
        const text = submenu.text || "Gaming Focused VPN:\n" +
            "Level up your gaming with our VPN—reduce ping, bypass geo-restrictions, and stay secure on any server. Say goodbye to lag and throttling; play smoothly, no matter where you are.\n\n" +
            "High Speed VPN:\n" +
            "Protect your privacy with our high-quality VPN—lightning-fast, ultra-secure, and trusted by professionals worldwide. Enjoy unrestricted access to the web with military-grade encryption and zero logs.\n\n";
        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: submenu.reply_markup
        });
    } else if (paymentsSubMenus[data]) {
        const submenu = paymentsSubMenus[data];
        bot.editMessageText(submenu.text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: submenu.reply_markup
        });
    } else if (data === 'payments') {
        bot.editMessageText('� Choose a payment method:', {
            chat_id: chatId,
            message_id: messageId,
            ...paymentsMenu
        });
    } else if (data === 'back_to_main') {
        bot.editMessageText(
            "Protect your privacy with a high-speed VPN built for security, reliability, and ease of use. Our premium servers ensure fast, encrypted connections worldwide—no logs, no limits.\n\nPlease choose your country of residence:",
            {
                chat_id: chatId,
                message_id: messageId,
                ...mainMenu
            }
        );
   } else if (data.startsWith('bw_')) {
    const bandwidthGb = parseInt(data.replace('bw_', ''), 10);
    const session = bot.session?.[userId];
    if (!session || !session.selectedServer) {
        bot.sendMessage(chatId, '❌ Error: No server selected. Please start again.');
        return;
    }

    const selectedServer = session.selectedServer;
/*
    try {
        const newKey = await createNewKey(selectedServer, userId, bandwidthGb);
        bot.sendMessage(chatId, `✅ Your access key:\n\`${newKey}\``, { parse_mode: 'Markdown' });
    //bot.sendMessage(chatId, '✅ Your access key:');
    //bot.sendMessage(chatId, newKey);
    } catch (err) {
        bot.sendMessage(chatId, `❌ Failed to create key: ${err.message}`);
    }
*/
	try {
	//	const username = msg.from.username;
     const eligible = await checkEligible(userId, chatId, bot);
const hasBalance = await checkBalance(userId);

    if (!eligible && !hasBalance) {
        bot.sendMessage(chatId, `❌ You do not have enough balance. Please use /payment to top up.`);
        return; // Stop here if not eligible and no balance
    }

    if (eligible) {
        bot.sendMessage(chatId, `✅ You are on the VIP list! Enjoy exclusive access.`);
    }

    const newKey = await createNewKey(selectedServer, userId, bandwidthGb);
    bot.sendMessage(chatId, `✅ Your access key:\n\`${newKey}\``, { parse_mode: 'Markdown' });

} catch (err) {
    bot.sendMessage(chatId, `❌ Failed to create key: ${err.message}`);
}


    // Clear session after use
    delete bot.session[userId];
}
	    
     else {
        bot.answerCallbackQuery(query.id, {
            text: 'Option selected!'
        });
    }

/*
  if (data === 'trigger_payment') {
    // Reuse the same logic as /payment
    await bot.sendMessage(chatId, '💳 This section is under development.', {
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Go Back', callback_data: 'back_to_main' }]]
      }
    });
  }*/


});
