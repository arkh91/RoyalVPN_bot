// payment/checkTickers.js
//
// Usage (from the bot's main folder):
//   node payment/checkTickers.js
//
// Compares every ticker in payment/config.js with the coins enabled on YOUR
// NowPayments account (GET /v1/merchant/coins) and prints OK / MISSING.
// Run it after editing config.js, and before going live.
const npClient = require('./npClient');
const { COINS } = require('./config');

/**
 * Usage:
 *   main();   // prints one line per configured ticker, exit code 1 if any is missing
 */
async function main() {
    const { data } = await npClient.get('/merchant/coins');
    const enabled = new Set((data.selectedCurrencies || []).map((c) => String(c).toLowerCase()));

    if (enabled.size === 0) {
        console.log('⚠️ NowPayments returned no enabled coins - check the API key / dashboard settings.');
    }

    let missing = 0;
    for (const [coinKey, coin] of Object.entries(COINS)) {
        for (const [netKey, net] of Object.entries(coin.networks)) {
            const ok = enabled.has(net.ticker.toLowerCase());
            if (!ok) missing++;
            console.log(`${ok ? '✅ OK     ' : '❌ MISSING'}  ${coinKey}/${netKey}  ->  ${net.ticker}`);
        }
    }

    if (missing) {
        console.log(`\n${missing} ticker(s) are not enabled. Enable them in the NowPayments dashboard (Coins settings) or fix the ticker in payment/config.js.`);
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('Check failed:', err.response?.status, err.response?.data?.message || err.message);
    process.exitCode = 1;
});
