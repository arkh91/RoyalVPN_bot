// payment/config.js
//
// Single place to change anything about crypto top-ups: which coins/networks
// are offered, the NowPayments ticker behind each button, the amounts, and
// how often the background poller checks for payments.
//
// Usage:
//   const { COINS, AMOUNTS_USD } = require('./config');
//   COINS.usdt.networks.ton.ticker   // -> 'usdtton'  (the pay_currency sent to NowPayments)
//
// To add a coin/network: add an entry below, then run
//   node payment/checkTickers.js
// which asks NowPayments whether every ticker here is enabled on your account.
// To hide a coin without deleting it, comment it out (see Toncoin below).

const COINS = {
    usdc: {
        label: 'USDC',
        symbol: 'USDC',
        networks: {
            bsc: { label: 'Binance network (BSC)', ticker: 'usdcbsc' },
            sol: { label: 'Solana',                ticker: 'usdcsol' }
        }
    },

    usdt: {
        label: 'USDT',
        symbol: 'USDT',
        networks: {
            ton: { label: ' TON',            ticker: 'usdtton', fee: '$0.001 - $0.005', speed: '1-3 sec' },
            bsc: { label: ' BNB Smart Chain', ticker: 'usdtbsc', fee: '$0.01 - $0.10',   speed: '3-5 sec' }
        }
    },

    doge: {
        label: 'Dogecoin (DOGE)',
        symbol: 'DOGE',
        networks: {
            doge: { label: 'Dogecoin (DOGE)', ticker: 'doge' }
        }
    }

    // Toncoin is switching to "Gram" - disabled for now, re-enable once
    // NowPayments lists the new ticker (check with: node payment/checkTickers.js).
    //
    // ton: {
    //     label: 'Toncoin (TON)',
    //     symbol: 'TON',
    //     networks: {
    //         ton: { label: 'TON (The Open Network)', ticker: 'ton' }
    //     }
    // }
};

// Amounts (USD) offered on the buttons. The callback value is checked against
// this list, so a forged callback cannot request any other amount.
const AMOUNTS_USD = [3, 5, 10, 20, 50, 100];

// How often (ms) the background poller asks NowPayments about open payments.
const POLL_INTERVAL_MS = 30 * 1000;

// Pause (ms) between two NowPayments calls inside one poll round (rate-limit friendly).
const POLL_CALL_GAP_MS = 250;

// Only payments created in the last N days are polled; older 'waiting' rows are marked expired.
const LOOKBACK_DAYS = 8;

// A user may have at most this many unpaid crypto payments open at once.
const MAX_OPEN_PAYMENTS_PER_USER = 5;

// Written to payments.PaymentMethod for rows created by the new flow. The poller
// ONLY touches rows with this value, so old invoice-based rows are left alone.
const PAYMENT_METHOD = 'NowPayments';

// NowPayments statuses. The balance is credited ONLY on CREDIT_STATUS.
const CREDIT_STATUS = 'finished';
const OPEN_STATUSES = ['waiting', 'confirming', 'confirmed', 'sending', 'partially_paid'];
const DEAD_STATUSES = ['failed', 'refunded', 'expired'];

// Telegram chat that receives alerts for things a human must look at
// (partial payments, amount mismatches). Same admin as commands.js.
const ADMIN_CHAT_ID = 542797568;

// Optional: public https URL of your IPN endpoint (see payment/ipn.js). Leave
// empty to rely on polling only - nothing else needs to be exposed.
const IPN_CALLBACK_URL = process.env.NP_IPN_URL || '';

module.exports = {
    COINS,
    AMOUNTS_USD,
    POLL_INTERVAL_MS,
    POLL_CALL_GAP_MS,
    LOOKBACK_DAYS,
    MAX_OPEN_PAYMENTS_PER_USER,
    PAYMENT_METHOD,
    CREDIT_STATUS,
    OPEN_STATUSES,
    DEAD_STATUSES,
    ADMIN_CHAT_ID,
    IPN_CALLBACK_URL
};
