const TelegramBot = require('node-telegram-bot-api');

const token = 'Token';

const bot = new TelegramBot(token, { polling: true });

// منوی اصلی
const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'یک', callback_data: 'menu_1' }],
            [{ text: 'دو', callback_data: 'menu_2' }],
            [{ text: 'سه', callback_data: 'menu_3' }],
        ]
    }
};

// زیرمنوها
const subMenus = {
    menu_1: {
        text: 'زیرمنوی گزینه یک:',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'گزینه 1.1', callback_data: 'sub_1_1' },
                    { text: 'گزینه 1.2', callback_data: 'sub_1_2' }
                ],
                [
                    { text: '🔙 Go Back', callback_data: 'back' }
                ]
            ]
        }
    },
    menu_2: {
        text: 'زیرمنوی گزینه دو:',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'گزینه 2.1', callback_data: 'sub_2_1' },
                    { text: 'گزینه 2.2', callback_data: 'sub_2_2' }
                ],
                [
                    { text: '🔙 Go Back', callback_data: 'back' }
                ]
            ]
        }
    },
    menu_3: {
        text: 'زیرمنوی گزینه سه:',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'گزینه 3.1', callback_data: 'sub_3_1' },
                    { text: 'گزینه 3.2', callback_data: 'sub_3_2' }
                ],
                [
                    { text: '🔙 Go Back', callback_data: 'back' }
                ]
            ]
        }
    }
};

// شروع
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Country of residence:', mainMenu);
});

// هندل کردن callback‌ها
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('menu_')) {
        bot.editMessageText(subMenus[data].text, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: subMenus[data].reply_markup
        });
    } else if (data === 'back') {
        bot.editMessageText('یکی از گزینه‌ها را انتخاب کن:', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: mainMenu.reply_markup
        });
    } else {
        bot.answerCallbackQuery(query.id, { text: `شما ${data} را انتخاب کردید.` });
    }
});
