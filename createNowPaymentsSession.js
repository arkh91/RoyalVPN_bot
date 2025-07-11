const axios = require('axios');
const { NOWPAYMENTS_API_KEY } = require('./token');

async function createNowPaymentsSession(chatId, amountUSD, currency, orderId = null) {
    try {
        const payload = {
            price_amount: amountUSD,
            price_currency: 'usd',
            pay_currency: currency,
            order_id: orderId || `order_${chatId}_${Date.now()}`,
            //ipn_callback_url: 'https://yourdomain.com/webhook', // Recommended
            //success_url: 'https://yourdomain.com/success',
            //cancel_url: 'https://yourdomain.com/cancel'
        };

        console.log('📦 Creating invoice with payload:', payload);

        // Step 1: Create the invoice
        const invoiceResponse = await axios.post(
            'https://api.nowpayments.io/v1/invoice',
            payload,
            {
                headers: {
                    'x-api-key': NOWPAYMENTS_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('🔍 Invoice created:', invoiceResponse.data);

        // Step 2: Transform invoice response to match payment-style URL
        return {
            payment_url: `https://nowpayments.io/payment/?iid=${invoiceResponse.data.id}`, // Key change here
            payment_id: invoiceResponse.data.id,
            order_id: invoiceResponse.data.order_id,
            invoice_url: invoiceResponse.data.invoice_url // Keep original as backup
        };

    } catch (error) {
        console.error('❌ NowPayments Error:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
        return null;
    }
}

module.exports = createNowPaymentsSession;
