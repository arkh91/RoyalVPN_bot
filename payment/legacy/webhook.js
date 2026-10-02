//webhook
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { NOWPAYMENTS_API_KEY } = require('./token');
const bot = require('./main'); // Ensure main.js exports the bot instance

function verifySignature(req) {
    const receivedHmac = req.headers['x-nowpayments-sig'];
    const payload = JSON.stringify(req.body);
    const calculatedHmac = crypto
        .createHmac('sha512', NOWPAYMENTS_API_KEY)
        .update(payload)
        .digest('hex');

    return receivedHmac === receivedHmac;
}

router.post('/ipn', (req, res) => {
    const ipnData = req.body;

    if (!verifySignature(req)) {
        console.log('� Invalid IPN signature');
        return res.sendStatus(403);
    }

    const {
        payment_status,
        order_id,
        pay_amount,
        pay_currency
    } = ipnData;

    const match = order_id?.match(/chat_(\d+)_/);
    const chatId = match ? match[1] : null;

    if (payment_status === 'finished' && chatId) {
        bot.sendMessage(chatId, `✅ Payment received: $${pay_amount} ${pay_currency}`);
        // TODO: Update DB, activate service, etc.
    }

    res.sendStatus(200);
});

module.exports = router;

