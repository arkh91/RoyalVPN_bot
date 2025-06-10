const TelegramBot = require('node-telegram-bot-api');
const insertUser = require('./db/insertUser'); // Adjust path as needed
const insertVisit = require('./db/insertVisit');
const { createNewKey } = require('./db/KeyCreation');
const { getKeyStatusResponseMessage } = require('./KeyStatus');
const token = '';

//payments key
const { paymentsMenu, paymentsSubMenus } = require('./payments');

// Track which users are waiting to send a key
const waitingForKey = new Set();

//AccountCreation
//const insertUser = require('./database/AccountCreation.js');


// Create a bot that uses polling
const bot = new TelegramBot(token, {
    polling: {
        interval: 300,       // Check for updates every 300ms
        autoStart: true,
        params: {
            timeout: 10        // Long polling timeout
        }
    }
});
// Main menu with three options in separate rows
const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'IRAN🇮🇷', callback_data: 'menu_1' }],
            [{ text: 'Russia🇷🇺', callback_data: 'menu_1' }],
            [{ text: 'India🇮🇳', callback_data: 'menu_1' }],
        ]
    }
};

// Submenus for each main menu option (1 button per row)
const subMenus = {
    menu_1: {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Game', callback_data: 'sub_1_game' }],
                [{ text: 'High Speed', callback_data: 'sub_1_speed' }],
                [{ text: '� Go Back', callback_data: 'back_to_main' }]
            ]
        }
    },
    menu_2: {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Sub 2-1', callback_data: 'sub_2_1' }],
                [{ text: 'Sub 2-2', callback_data: 'sub_2_2' }],
                [{ text: '� Go Back', callback_data: 'back_to_main' }]
            ]
        }
    },
    menu_3: {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Sub 3-1', callback_data: 'sub_3_1' }],
                [{ text: 'Sub 3-2', callback_data: 'sub_3_2' }],
                [{ text: '� Go Back', callback_data: 'back_to_main' }]
            ]
        }
    },

    // Submenu for Game
    sub_1_game: {
        text: '� Choose a game-optimized server for smoother, faster gameplay:',
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Arena Breakout', callback_data: 'game_arena' }],
                [{ text: 'FIFA', callback_data: 'game_fifa' }],
                [{ text: 'Call of Duty Mobile', callback_data: 'game_codm' }],
                [{ text: '� Go Back', callback_data: 'menu_1' }]
            ]
        }
    },

    // Submenu for High Speed
    sub_1_speed: {
        text: '⚡ Choose a high-speed location for fast and secure internet:',
        /*
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Sweden', callback_data: 'speed_ca' }],
                [{ text: 'Sweden', callback_data: 'speed_sweden' }],
                [{ text: 'Spain', callback_data: 'speed_sp' }],
                [{ text: 'Iran', callback_data: 'speed_ir' }],
                [{ text: 'Italy', callback_data: 'speed_it' }],
                [{ text: 'Turkey', callback_data: 'speed_tur' }],
                [{ text: 'USA', callback_data: 'speed_usa' }],
                [{ text: 'UK', callback_data: 'speed_uk' }],
                [{ text: '� Go Back', callback_data: 'menu_1' }]
            ]
        }
        */
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
                [
                    { text: '� Go Back', callback_data: 'menu_1' }
                ]
            ]
        }

    }

};

// Function to handle and log user info
function handleUserInfo(msg) {
    const userId = msg.from.id;
    const username = msg.from.username || 'No username';
    const firstName = msg.from.first_name || '';
    const lastName = msg.from.last_name || '';

    console.log(`User ID: ${userId}`);
    console.log(`Username: ${username}`);
    console.log(`First Name: ${firstName}`);
    console.log(`Last Name: ${lastName}`);
}

// Start command sends the main menu
bot.onText(/\/start/, async (msg) => {
    //handleUserInfo(msg);
    try {
        await insertUser(msg.from); // insert or update user info
    } catch (err) {
        console.error('Error inserting user:', err);
    }

	try {
		await insertVisit(msg.from.id);     // Log visit
	} catch {
		console.error('Error inserting user:', err);
    }

	bot.sendMessage(
        msg.chat.id,
        "Protect your privacy with a high-speed VPN built for security, reliability, and ease of use. Our premium servers ensure fast, encrypted connections worldwide—no logs, no limits. Whether you're streaming, working, or browsing, stay safe and anonymous with just one click.\n\nPlease choose your country of residence:",
        mainMenu
    );
});
//const userId = msg.from.id;
// Handle /userid command
bot.onText(/\/userid/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || 'No username';
    const firstName = msg.from.first_name || '';
    const lastName = msg.from.last_name || '';

    const message = `� *User Information*\n\n` +
        `� *User ID:* \`${userId}\`\n` +
        `� *Username:* @${username}\n` +
        `� *Full Name:* ${firstName} ${lastName}`.trim();

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Handle /payments command
bot.onText(/\/payment/, (msg) => {
    const chatId = msg.chat.id;

    const underDevelopmentMessage = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '� Go Back', callback_data: 'back_to_main' }]
            ]
        }
    };

    bot.sendMessage(chatId, '� This section is under development. Please check back later.', underDevelopmentMessage);
});

// Handle /ps command
bot.onText(/\/ps/, (msg) => {
    const chatId = msg.chat.id;

    const underDevelopmentMessage = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '� Go Back', callback_data: 'back_to_main' }]
            ]
        }
    };

    bot.sendMessage(chatId, '� This section is under development. Please check back later.', underDevelopmentMessage);
});


bot.onText(/\/KeyStatus/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '� Please send me your key now:');
    waitingForKey.add(chatId);
});

// Handle all messages 
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
            bot.sendMessage(chatId, `� Error: ${err.message}`);
            bot.sendMessage(chatId, `Here`);
	}
    }
});


// Map callback data to server key in KeyCreation.js
const callbackToServer = {
    speed_ger: 'Ger',
    speed_sweden: 'Sweden82',
    speed_sp: 'Spain', // Add this server to KeyCreation.js if needed
    speed_ir: 'IRAN',
    speed_it: 'IT01',
    speed_tur: 'TUR14',
    speed_usa: 'US05',
    speed_uk: 'UK36'
};

// Callback query handling
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const userId = query.message.from.id;
		
    // Handle VPN speed location buttons (trigger key creation)
    if (callbackToServer[data]) {
        const selectedServer = callbackToServer[data];

        bot.answerCallbackQuery(query.id, {
            text: `� Creating VPN key for ${selectedServer}... Please wait.`,
            show_alert: false
        });

      try {
    const vpnKeyUrl = await createNewKey(selectedServer, userId);
    bot.sendMessage(chatId, `✅ VPN key successfully created for ${selectedServer}`);//.\n\n� Your key:\n${vpnKeyUrl}`);
    bot.sendMessage(chatId, `${vpnKeyUrl}`);	      
} catch (err) {
    console.error('❌ Key creation error:', err);
    bot.sendMessage(chatId, `⚠️ Failed to create VPN key for ${selectedServer}.`);
}

        return;
    }

    // Main VPN submenus
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

    // Payments submenus
    } else if (paymentsSubMenus[data]) {
        const submenu = paymentsSubMenus[data];
        bot.editMessageText(submenu.text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: submenu.reply_markup
        });

    // Go back to payments main
    } else if (data === 'payments') {
        bot.editMessageText('� Choose a payment method:', {
            chat_id: chatId,
            message_id: messageId,
            ...paymentsMenu
        });

    // Go back to main menu
    } else if (data === 'back_to_main') {
        bot.editMessageText(
            "Protect your privacy with a high-speed VPN built for security, reliability, and ease of use. Our premium servers ensure fast, encrypted connections worldwide—no logs, no limits.\n\nPlease choose your country of residence:",
            {
                chat_id: chatId,
                message_id: messageId,
                ...mainMenu
            }
        );

    // Leaf node (default handler)
    } else {
        bot.answerCallbackQuery(query.id, {
            text: 'Option selected!'
        });
    }
});
