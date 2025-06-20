const axios = require('axios');

async function createNowPaymentsSession(chatId, amountUSD, currency, orderId = null) {
    try {
        const payload = {
            price_amount: amountUSD,
            price_currency: 'usd',
            pay_currency: currency,
            order_id: orderId || `order_${chatId}_${Date.now()}`,
            ipn_callback_url: 'https://your-server.com/ipn-handler', // Optional
        };

        const response = await axios.post('https://api.nowpayments.io/v1/invoice', payload, {
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY || NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.invoice_url) {
            return response.data.invoice_url;
        } else {
            throw new Error('No invoice URL returned.');
        }
    } catch (error) {
        console.error('NowPayments Error:', error.response?.data || error.message);
        return null;
    }
}

module.exports = createNowPaymentsSession;
