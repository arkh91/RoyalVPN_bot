// pricing.js
//
// All product prices + the USD<->IRC (Rial) rate live here so main.js does
// not carry price tables any more.
//
//   Iran menu          -> customer pays in IRC (Rial)
//   International menu -> customer pays in USD
//
// IRC prices are derived from the USD prices (x IRC_PER_USD, rounded to
// IRC_ROUND_TO). To use hand-picked Rial prices instead, fill IRC_OVERRIDES.
//
// REQUIRED: set the rate, otherwise the bot refuses to start (so it can never
// silently charge the wrong amount). Either edit CONFIGURED_IRC_PER_USD below
// (vi pricing.js) or start the bot with:  IRC_PER_USD=1000000 node main.js

const { formatMoney } = require('./currency');

const CONFIGURED_IRC_PER_USD = 1450000;   // <-- Rial per 1 USD (or use the IRC_PER_USD env var)
const IRC_PER_USD = Number(process.env.IRC_PER_USD) || CONFIGURED_IRC_PER_USD;
if (!(IRC_PER_USD > 0)) {
    throw new Error('pricing.js: set IRC_PER_USD (env var) or CONFIGURED_IRC_PER_USD (Rial per 1 USD) before starting the bot.');
}

const IRC_ROUND_TO = 1000;                 // round derived Rial prices to the nearest 1,000
const ALLOW_USD_FALLBACK_FOR_IRC = true;   // Iran purchase: if Rial balance is too low but USD balance covers the USD price, charge USD

// Optional hand-picked Rial prices. Anything left empty is derived from USD.
const IRC_OVERRIDES = {
    outline: {20: 1690000, 40: 2690000, 50: 3190000, 70:3990000, 100:4990000, 300: 6550000},          // e.g. { 20: 250000, 40: 300000 }        (GB -> Rial)
    wgBase: {30: 1850000},           // e.g. { 40: 150000 }                    (GB -> Rial, 1 device)
    wgExtraDevice: 350000,//null,  // e.g. 120000                            (Rial per extra device)
    arena: {}             // e.g. { 25: 130000, 50: 250000 }
};

// ---- USD price tables (moved verbatim from main.js) ----------------------
const OUTLINE_USD = { 20: 1.99, 40: 2.19, 50: 2.29, 70: 2.79, 100: 3.29, 300: 6.49, 500: 10.30, 1000: 17.99 };
const WG_BASE_USD = { 30: 2.17, 50: 2.19, 70: 2.59, 100: 3.19, 300: 6.29 };
const WG_EXTRA_DEVICE_USD = 1.00;
const ARENA_USD = { 25: 0.99, 50: 1.89 };

// Sizes shown in the menus
const IRAN_OUTLINE_GBS = [20, 40, 50, 70, 100, 300];
const WG_GB_OPTIONS = Object.keys(WG_BASE_USD).map(Number);

/**
 * Usage:
 *   usdToIrc(1.99)   // -> Rial price rounded to IRC_ROUND_TO
 */
function usdToIrc(usd) {
    return Math.round((usd * IRC_PER_USD) / IRC_ROUND_TO) * IRC_ROUND_TO;
}

/**
 * Usage:
 *   getOutlinePrice(50, 'IRC')  // Iran Outline 50 GB price in Rial
 *   getOutlinePrice(50, 'USD')  // -> 2.29
 *   getOutlinePrice(7, 'USD')   // -> undefined (unknown size)
 */
function getOutlinePrice(bandwidthGb, currency) {
    const usd = OUTLINE_USD[bandwidthGb];
    if (usd === undefined) return undefined;
    if (currency === 'USD') return usd;
    return IRC_OVERRIDES.outline[bandwidthGb] ?? usdToIrc(usd);
}

/**
 * Usage:
 *   getWgExtraDeviceFee('IRC')  // Rial fee for each device after the first
 *   getWgExtraDeviceFee('USD')  // -> 1
 */
function getWgExtraDeviceFee(currency) {
    if (currency === 'USD') return WG_EXTRA_DEVICE_USD;
    return IRC_OVERRIDES.wgExtraDevice ?? usdToIrc(WG_EXTRA_DEVICE_USD);
}

/**
 * Usage:
 *   getWgPrice(100, 2, 'IRC')  // 100 GB, 2 devices, in Rial
 *   getWgPrice(100, 1, 'USD')  // -> 2.33
 *   getWgPrice(7, 1, 'USD')    // -> undefined (unknown size)
 * Price = base (1 device) + fee for every additional device.
 */
function getWgPrice(bandwidthGb, deviceCount, currency) {
    const baseUsd = WG_BASE_USD[bandwidthGb];
    if (baseUsd === undefined) return undefined;
    const extraDevices = Math.max(0, (deviceCount || 1) - 1);
    if (currency === 'USD') {
        return Math.round((baseUsd + extraDevices * WG_EXTRA_DEVICE_USD) * 100) / 100;
    }
    const baseIrc = IRC_OVERRIDES.wgBase[bandwidthGb] ?? usdToIrc(baseUsd);
    return baseIrc + extraDevices * getWgExtraDeviceFee('IRC');
}

/**
 * Usage:
 *   getArenaPrice(25, 'IRC')  // Arena Breakout 25 GB in Rial
 *   getArenaPrice(25, 'USD')  // -> 0.99
 */
function getArenaPrice(bandwidthGb, currency) {
    const usd = ARENA_USD[bandwidthGb];
    if (usd === undefined) return undefined;
    if (currency === 'USD') return usd;
    return IRC_OVERRIDES.arena[bandwidthGb] ?? usdToIrc(usd);
}

/**
 * Usage:
 *   insufficientFundsText({
 *       preferred: 'IRC',                            // wallet the menu charges
 *       prices:    { IRC: 2000000, USD: 1.99 },
 *       balances:  { IRC: 0, USD: 0.5 },             // from choosePaymentCurrency()
 *       what:      '20 GB'
 *   })  // -> user-facing "not enough balance" message
 */
function insufficientFundsText({ preferred, prices, balances, what }) {
    if (preferred === 'IRC') {
        if (ALLOW_USD_FALLBACK_FOR_IRC && prices.USD) {
            return `❌ Not enough balance to buy ${what}.\n` +
                   `Price: ${formatMoney('IRC', prices.IRC)} (or ${formatMoney('USD', prices.USD)})\n` +
                   `Your balance: ${formatMoney('IRC', balances.IRC)} | ${formatMoney('USD', balances.USD)}\n\n` +
                   `Contact support to top up your Rial balance, or use /payment to top up with crypto.`;
        }
        return `❌ You need at least ${formatMoney('IRC', prices.IRC)} to buy ${what}.\n` +
               `Your current balance: ${formatMoney('IRC', balances.IRC)}.\n\n` +
               `Contact support to top up your Rial balance.`;
    }
    return `❌ You need at least ${formatMoney('USD', prices.USD)} to buy ${what}.\n` +
           `Your current balance: ${formatMoney('USD', balances.USD)}.\n\n` +
           `Use /payment to top up.`;
}

module.exports = {
    IRC_PER_USD,
    ALLOW_USD_FALLBACK_FOR_IRC,
    IRAN_OUTLINE_GBS,
    WG_GB_OPTIONS,
    usdToIrc,
    getOutlinePrice,
    getWgExtraDeviceFee,
    getWgPrice,
    getArenaPrice,
    insufficientFundsText
};
