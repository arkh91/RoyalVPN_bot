// payments.js

const paymentsMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'Toncoin', callback_data: 'payments_toncoin' }],
            [{ text: 'Bitcoin', callback_data: 'payments_bitcoin' }],
            [{ text: '� Go Back', callback_data: 'back_to_main' }]
            //console.log(`Hello`)
        ]
    }
};

const paymentsSubMenus = {
    payments_toncoin: {
        text: '� Toncoin Network Options:',
        reply_markup: {
            inline_keyboard: [
                [{ text: 'TON', callback_data: 'toncoin_network_ton' }],
                [{ text: '� Go Back', callback_data: 'payments' }]
            ]
        }
    },
    payments_bitcoin: {
        text: '� Bitcoin Network Options:',
        reply_markup: {
            inline_keyboard: [
                [{ text: 'BTC', callback_data: 'bitcoin_network_btc' }],
                [{ text: '� Go Back', callback_data: 'payments' }]
            ]
        }
    },
    toncoin_network_ton: {
        text: '✅ Toncoin on TON network: Fast, scalable, and cost-effective blockchain.',
        reply_markup: {
            inline_keyboard: [
                [{ text: '� Go Back', callback_data: 'payments_toncoin' }]
            ]
        }
    },
    bitcoin_network_btc: {
        text: '✅ Bitcoin on BTC network: The original decentralized currency, trusted worldwide.',
        reply_markup: {
            inline_keyboard: [
                [{ text: '� Go Back', callback_data: 'payments_bitcoin' }]
            ]
        }
    }
};

module.exports = {
    paymentsMenu,
    paymentsSubMenus
};

