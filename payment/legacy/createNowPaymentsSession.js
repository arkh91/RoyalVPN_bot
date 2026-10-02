/*
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
/*
        // Step 2: Transform invoice response to match payment-style URL
        return {
            payment_url: `https://nowpayments.io/payment/?iid=${invoiceResponse.data.id}`, // Key change here
            payment_id: invoiceResponse.data.id,
            order_id: invoiceResponse.data.order_id,
            invoice_url: invoiceResponse.data.invoice_url // Keep original as backup
        };

	// Step 2: Transform invoice response to match payment-style URL
const paymentUrl = `https://nowpayments.io/payment/?iid=${invoiceResponse.data.id}`;
const invoiceIdFromUrl = new URL(paymentUrl).searchParams.get("iid"); // Extract from URL
	return {
    		payment_url: `https://nowpayments.io/payment/?iid=${invoiceResponse.data.id}`, // Key change here
    		payment_id: invoiceResponse.data.id,
    		order_id: invoiceResponse.data.order_id,
    		invoice_url: invoiceResponse.data.invoice_url, // Keep original as backup
    		invoice_id: invoiceIdFromUrl // ✅ Now correctly extracted from URL
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
*/
// createNowPaymentsSession.js
const npClient = require("./npClient");

async function createNowPaymentsSession(chatId, amountUSD, currency, orderId = null) {
  try {
    const payload = {
      price_amount: amountUSD,
      price_currency: "usd",
      pay_currency: currency,
      order_id: orderId || `order_${chatId}_${Date.now()}`
      // ipn_callback_url: 'https://yourdomain.com/ipn'
    };

    console.log("� Creating invoice with payload:", payload);

    const { data } = await npClient.post("/invoice", payload);

    console.log("� Invoice created:", data);

    return {
      payment_url: `https://nowpayments.io/payment/?iid=${data.id}`,
      payment_id: data.id,
      order_id: data.order_id,
      invoice_url: data.invoice_url,
      invoice_id: data.id // same as iid
    };
  } catch (error) {
    console.error("❌ NowPayments Error:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    return null;
  }
}

module.exports = createNowPaymentsSession;

