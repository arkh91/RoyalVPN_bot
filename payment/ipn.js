// payment/ipn.js   (OPTIONAL - not used unless you mount it)
//
// Instant Payment Notifications: NowPayments POSTs to your server the moment a
// status changes, so users are notified within seconds instead of at the next
// poll. You do NOT need this - the poller already works on its own. It only
// helps if the bot's server is reachable from the internet over HTTPS.
//
// Usage:
//   const express = require('express');
//   const { createIpnRouter } = require('./payment/ipn');
//   const app = express();
//   app.use(express.json());                       // must come before the router
//   app.use('/np', createIpnRouter(bot, db));      // POST /np/ipn
//   app.listen(3000);
//   // then:  export NP_IPN_URL=https://your.domain/np/ipn   (before starting the bot)
//   // and put your IPN secret (NowPayments dashboard > Store settings) in token.js as IPN.
//
// The old webhook.js always returned "signature OK" (receivedHmac === receivedHmac),
// so anyone could have faked a payment. This version verifies the HMAC properly,
// and even then only uses the POST as a trigger: the real status is re-fetched
// from NowPayments before anything is credited.

const crypto = require('crypto');
const express = require('express');
const { IPN } = require('../token');
const getNowPaymentsStatus = require('./getNowPaymentsStatus');
const { applyPaymentStatus } = require('./settlePayment');
const { PAYMENT_METHOD } = require('./config');

/**
 * Usage:
 *   JSON.stringify(sortKeys({ b: 1, a: { d: 1, c: 2 } }))   // -> '{"a":{"c":2,"d":1},"b":1}'
 *
 * NowPayments signs the body with keys sorted alphabetically (recursively).
 */
function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key] = sortKeys(value[key]);
            return acc;
        }, {});
    }
    return value;
}

/**
 * Usage:
 *   if (!verifySignature(req.body, req.headers['x-nowpayments-sig'])) return res.sendStatus(403);
 */
function verifySignature(body, receivedSig) {
    if (!IPN || !receivedSig) return false;
    const expected = crypto.createHmac('sha512', IPN).update(JSON.stringify(sortKeys(body))).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(receivedSig));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Usage:
 *   app.use('/np', createIpnRouter(bot, db));
 */
function createIpnRouter(bot, db) {
    const router = express.Router();

    router.post('/ipn', async (req, res) => {
        if (!verifySignature(req.body, req.headers['x-nowpayments-sig'])) {
            console.warn('🚫 IPN with invalid signature rejected');
            return res.sendStatus(403);
        }

        res.sendStatus(200); // answer fast; NowPayments retries on timeouts

        try {
            const paymentId = String(req.body.payment_id || '');
            if (!paymentId) return;

            const [rows] = await db.query(
                'SELECT UserID, OrderID, PaymentID, Status FROM payments WHERE PaymentID = ? AND PaymentMethod = ?',
                [paymentId, PAYMENT_METHOD]
            );
            if (!rows[0]) return;

            const fresh = await getNowPaymentsStatus(paymentId); // never trust the POST body for money
            if (fresh) await applyPaymentStatus(db, bot, rows[0], fresh);
        } catch (err) {
            console.error('❌ IPN handling failed:', err.message);
        }
    });

    return router;
}

module.exports = { createIpnRouter, verifySignature, sortKeys };
