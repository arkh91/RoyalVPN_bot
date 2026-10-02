// db/choosePaymentCurrency.js
const getUserBalance = require('./getUserBalance');
const { ALLOW_USD_FALLBACK_FOR_IRC } = require('../pricing');

/**
 * Decides which wallet pays for a purchase.
 *
 * Usage:
 *   const prices  = { IRC: 2000000, USD: 1.99 };
 *   const payment = await choosePaymentCurrency(userId, prices, 'IRC');
 *   // payment = { currency: 'IRC'|'USD'|null, amount, balances: { IRC, USD } }
 *   // currency === null  -> neither wallet can cover the price
 *
 * preferred 'IRC' (Iran menu): try Rial first, then USD if
 *   ALLOW_USD_FALLBACK_FOR_IRC is true (so existing users who only hold USD
 *   are not locked out).
 * preferred 'USD' (International menu): USD only.
 */
async function choosePaymentCurrency(userId, prices, preferred = 'IRC') {
    const order = [preferred];
    if (preferred === 'IRC' && ALLOW_USD_FALLBACK_FOR_IRC && prices.USD) order.push('USD');

    const balances = {};
    for (const cur of order) {
        balances[cur] = await getUserBalance(userId, cur);
    }
    for (const cur of order) {
        const price = prices[cur];
        if (price && balances[cur] >= price) {
            return { currency: cur, amount: price, balances };
        }
    }
    return { currency: null, amount: null, balances };
}

module.exports = choosePaymentCurrency;
