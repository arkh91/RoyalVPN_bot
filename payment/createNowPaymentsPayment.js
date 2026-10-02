// payment/createNowPaymentsPayment.js
//
// Replaces the old createNowPaymentsSession.js (invoice link).
//
// Why: an invoice only gets a payment_id AFTER the customer opens the page and
// picks a coin, so the bot cannot poll it. A direct payment returns the
// payment_id, address and exact amount immediately - the poller can track it
// from the first second, and the bot shows the address inside Telegram.

const npClient = require('./npClient');
const { IPN_CALLBACK_URL } = require('./config');

/**
 * Usage:
 *   const p = await createNowPaymentsPayment(orderId, 10, 'usdtton');
 *   // p = { payment_id, order_id, status, pay_address, pay_amount,
 *   //       pay_currency, payin_extra_id, valid_until }
 *   // Throws on failure - use describeNowPaymentsError(err) for a message.
 *
 * orderId  our own unique id (payments.OrderID)
 * amountUSD  price in USD
 * payCurrency  NowPayments ticker, e.g. 'usdtton', 'doge'
 */
async function createNowPaymentsPayment(orderId, amountUSD, payCurrency) {
    const payload = {
        price_amount: amountUSD,
        price_currency: 'usd',
        pay_currency: payCurrency,
        order_id: orderId,
        order_description: 'RoyalVPN balance top-up'
    };
    if (IPN_CALLBACK_URL) payload.ipn_callback_url = IPN_CALLBACK_URL;

    const { data } = await npClient.post('/payment', payload);

    return {
        payment_id: String(data.payment_id),
        order_id: data.order_id,
        status: data.payment_status,
        pay_address: data.pay_address,
        pay_amount: data.pay_amount,
        pay_currency: data.pay_currency,
        payin_extra_id: data.payin_extra_id || null,
        valid_until: data.valid_until || data.expiration_estimate_date || null
    };
}

/**
 * Usage:
 *   try { ... } catch (err) { console.error(describeNowPaymentsError(err)); }
 *
 * Turns an axios error into one readable line (NowPayments puts the reason,
 * e.g. "amount is less than minimal", in err.response.data.message).
 */
function describeNowPaymentsError(err) {
    const status = err.response?.status;
    const message = err.response?.data?.message || err.message;
    return status ? `HTTP ${status}: ${message}` : message;
}

module.exports = { createNowPaymentsPayment, describeNowPaymentsError };
