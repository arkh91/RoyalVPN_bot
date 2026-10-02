// payment/poller.js
//
// Replaces the manual "check payment status" command: a background job asks
// NowPayments about every open payment and the bot messages the user by itself.
//
// Usage (in main.js, once, after `bot` and `db` exist):
//   const { startPaymentPoller } = require('./payment');
//   startPaymentPoller(bot, db);
//
// Cost: one small API call per OPEN payment per round (default every 30 s).
// With no open payments it only runs one cheap SELECT.

const getNowPaymentsStatus = require('./getNowPaymentsStatus');
const { applyPaymentStatus } = require('./settlePayment');
const {
    PAYMENT_METHOD,
    OPEN_STATUSES,
    LOOKBACK_DAYS,
    POLL_INTERVAL_MS,
    POLL_CALL_GAP_MS
} = require('./config');

/**
 * Usage:
 *   await sleep(250);
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Usage:
 *   await expireStaleRows(db);
 *
 * Rows still 'waiting' after LOOKBACK_DAYS are marked 'expired' so they stop
 * being polled. (PaymentDate is a DATE column, so this works in whole days.)
 */
async function expireStaleRows(db) {
    await db.query(
        `UPDATE payments
            SET Status = 'expired', Comments = 'No payment received - expired'
          WHERE PaymentMethod = ?
            AND Status = 'waiting'
            AND PaymentDate < DATE_SUB(CURDATE(), INTERVAL ${Number(LOOKBACK_DAYS)} DAY)`,
        [PAYMENT_METHOD]
    );
}

/**
 * Usage:
 *   await pollOnce(bot, db);
 *
 * One round: load open payments, ask NowPayments for each, apply changes.
 */
async function pollOnce(bot, db) {
    await expireStaleRows(db);

    const placeholders = OPEN_STATUSES.map(() => '?').join(', ');
    const [rows] = await db.query(
        `SELECT UserID, OrderID, PaymentID, Status
           FROM payments
          WHERE PaymentMethod = ?
            AND PaymentID IS NOT NULL
            AND Status IN (${placeholders})
          ORDER BY PaymentDate ASC`,
        [PAYMENT_METHOD, ...OPEN_STATUSES]
    );

    for (const row of rows) {
        const apiData = await getNowPaymentsStatus(row.PaymentID);
        if (apiData) {
            try {
                await applyPaymentStatus(db, bot, row, apiData);
            } catch (err) {
                console.error(`❌ applyPaymentStatus failed for ${row.OrderID}:`, err.message);
            }
        }
        await sleep(POLL_CALL_GAP_MS);
    }
}

/**
 * Usage:
 *   const stop = startPaymentPoller(bot, db);              // default interval
 *   const stop = startPaymentPoller(bot, db, 10 * 1000);   // every 10 s
 *   stop();                                                // stop polling
 *
 * Starts the loop. Rounds never overlap: if one is still running when the
 * timer fires, that tick is skipped.
 */
function startPaymentPoller(bot, db, intervalMs = POLL_INTERVAL_MS) {
    let running = false;

    /**
     * Usage: (internal) called by the timer.
     */
    async function tick() {
        if (running) return;
        running = true;
        try {
            await pollOnce(bot, db);
        } catch (err) {
            console.error('❌ Payment poller round failed:', err.message);
        } finally {
            running = false;
        }
    }

    const timer = setInterval(tick, intervalMs);
    setTimeout(tick, 5000); // first round shortly after start-up
    console.log(`🔄 Payment poller started (every ${intervalMs / 1000}s)`);

    return () => clearInterval(timer);
}

module.exports = { startPaymentPoller, pollOnce };
