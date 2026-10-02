// currency.js
//
// Single source of truth for the two wallets stored in `accounts`:
//   USD  -> accounts.CurrentBalance   (unchanged, DECIMAL(10,2))
//   IRC  -> accounts.IRC              (Iranian currency / Rial, whole numbers)
//
// Admin commands take the wallet as an argument written "usd" or "rial".
// Column names are looked up here (never taken from user input), so it is
// safe to interpolate them into SQL via columnFor().

const CURRENCIES = {
    USD: { column: 'CurrentBalance', label: 'USD',  decimals: 2 },
    IRC: { column: 'IRC',            label: 'Rial', decimals: 0 }
};

// Words an admin may type for each wallet (case-insensitive).
const CURRENCY_WORDS = { usd: 'USD', rial: 'IRC', irc: 'IRC' };

/**
 * Usage:
 *   normalizeCurrency('rial')     // -> 'IRC'
 *   normalizeCurrency(' USD ')    // -> 'USD'
 *   normalizeCurrency('abc')      // -> null  (not a currency word)
 *   normalizeCurrency(undefined)  // -> null
 */
function normalizeCurrency(input) {
    if (typeof input !== 'string') return null;
    return CURRENCY_WORDS[input.trim().toLowerCase()] || null;
}

/**
 * Usage:
 *   tokenize('  rial  bob123   180000 ')  // -> ['rial', 'bob123', '180000']
 *   tokenize(undefined)                   // -> []
 */
function tokenize(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Pulls the usd/rial word out of an argument list and returns the remaining
 * arguments in their original order.
 *
 * Usage:
 *   extractCurrency(['rial', 'bob123', '180000'])  // -> { currency: 'IRC', rest: ['bob123', '180000'] }
 *   extractCurrency(['bob123', 'usd', '2'])        // -> { currency: 'USD', rest: ['bob123', '2'] }
 *   extractCurrency(['bob123', '2'])               // -> { currency: null,  rest: ['bob123', '2'] }
 *
 * The word may sit anywhere because it can never be confused with the other
 * arguments: Telegram usernames need at least 5 characters ("usd"/"rial" are
 * shorter), and UserIDs / amounts / counts are numbers.
 */
function extractCurrency(tokens) {
    const idx = tokens.findIndex(t => normalizeCurrency(t) !== null);
    if (idx === -1) return { currency: null, rest: tokens.slice() };
    return { currency: normalizeCurrency(tokens[idx]), rest: tokens.filter((_, i) => i !== idx) };
}

/**
 * Usage:
 *   columnFor('IRC')  // -> 'IRC'
 *   columnFor('USD')  // -> 'CurrentBalance'
 *   columnFor('xyz')  // throws Error (programming mistake, fail loudly)
 */
function columnFor(currency) {
    const entry = CURRENCIES[currency];
    if (!entry) throw new Error(`Unknown currency: ${currency}`);
    return entry.column;
}

/**
 * Usage:
 *   formatMoney('USD', 1.5)        // -> '$1.50'
 *   formatMoney('IRC', 1200000)    // -> '1,200,000 Rial'
 *   formatMoney('IRC', '12000')    // -> '12,000 Rial'  (mysql2 returns DECIMAL as string)
 */
function formatMoney(currency, amount) {
    const n = Number(amount) || 0;
    if (currency === 'IRC') return `${Math.round(n).toLocaleString('en-US')} ${CURRENCIES.IRC.label}`;
    return `$${n.toFixed(2)}`;
}

/**
 * Usage:
 *   validateAmount('IRC', 500000)   // -> null   (ok)
 *   validateAmount('IRC', 1500.5)   // -> 'IRC amounts must be whole numbers.'
 *   validateAmount('USD', -3)       // -> 'Amount must be greater than 0.'
 * Returns an error string, or null when the amount is acceptable.
 */
function validateAmount(currency, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return 'Amount must be greater than 0.';
    if (currency === 'IRC') {
        if (!Number.isInteger(amount)) return 'Rial amounts must be whole numbers.';
        if (amount > 999999999999999) return 'Rial amount is too large (max 15 digits).';
    } else if (amount > 99999999.99) {
        return 'USD amount is too large.';
    }
    return null;
}

module.exports = {
    CURRENCIES,
    normalizeCurrency,
    tokenize,
    extractCurrency,
    columnFor,
    formatMoney,
    validateAmount
};
