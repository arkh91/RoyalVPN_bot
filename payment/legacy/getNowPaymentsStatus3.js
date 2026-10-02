const axios = require('axios');
const db = require('./db');
const { NOWPAYMENTS_API_KEY } = require('./token');

async function getNowPaymentsStatus(userId) {
  // 1. Get pending payments from database (last 24 hours only)
  const [rows] = await db.execute(
    `SELECT * FROM payments 
     WHERE UserID = ? 
     AND Status IN ('waiting', 'confirming', 'sending')
     AND PaymentDate > DATE_SUB(NOW(), INTERVAL 1 DAY)`,
    [userId]
  );

  const completedPayments = [];

  for (const payment of rows) {
    try {
      // 2. Verify each payment with NowPayments API
      const response = await axios.get(
        `https://api.nowpayments.io/v1/payment/${payment.PaymentID}`, 
        {
          headers: {
            'x-api-key': NOWPAYMENTS_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      const paymentData = response.data;

      // 3. Handle successful payments
      if (['finished', 'confirmed'].includes(paymentData.payment_status)) {
        completedPayments.push({
          dbRecord: payment,
          apiData: paymentData
        });

        // 4. Update database
        await db.execute(
          `UPDATE payments 
           SET Status = ?,
               DigitalCurrencyAmount = ?,
               CurrentRateToUSD = ?,
               Comments = ?
           WHERE PaymentID = ?`,
          [
            paymentData.payment_status,
            paymentData.actually_paid,
            paymentData.price_amount / paymentData.actually_paid,
            'Verified via status check',
            payment.PaymentID
          ]
        );
      }

    } catch (error) {
      // 5. Handle 404 errors (payment not found)
      if (error.response?.status === 404) {
        console.log(`Payment ${payment.PaymentID} not found - marking as expired`);
        await db.execute(
          `UPDATE payments 
           SET Status = 'expired', 
               Comments = 'Payment expired or cancelled'
           WHERE PaymentID = ?`,
          [payment.PaymentID]
        );
      } else {
        console.error(`Error checking payment ${payment.PaymentID}:`, error.message);
      }
    }
  }

  return completedPayments;
}

module.exports = getNowPaymentsStatus;
