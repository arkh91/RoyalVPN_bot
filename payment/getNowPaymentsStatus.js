// payment/getNowPaymentsStatus.js
//
// Usage:
//   const getNowPaymentsStatus = require('./getNowPaymentsStatus');
//   const data = await getNowPaymentsStatus('123456789');
//   // data.payment_status: 'waiting' | 'confirming' | 'confirmed' | 'sending' |
//   //                      'partially_paid' | 'finished' | 'failed' | 'refunded' | 'expired'
//   // Returns null when NowPayments could not be reached (try again next round).
//   // Returns { payment_status: 'not_found' } on HTTP 404.
const npClient = require('./npClient');

/**
 * Usage:
 *   const data = await getNowPaymentsStatus(row.PaymentID);
 *
 * One GET /payment/{id} call (API key only, no JWT needed).
 */
async function getNowPaymentsStatus(paymentId) {
    try {
        const { data } = await npClient.get(`/payment/${encodeURIComponent(paymentId)}`);
        return data;
    } catch (err) {
        if (err.response?.status === 404) return { payment_status: 'not_found' };
        console.error(`❌ NowPayments status check failed for ${paymentId}:`, err.response?.status, err.response?.data?.message || err.message);
        return null;
    }
}

module.exports = getNowPaymentsStatus;
