// payments.js

// payments.js (only updatePendingPayments function)

const axios = require('axios');

const db = require('./db');

async function updatePendingPayments(finishedPayments) {
  for (const payment of finishedPayments) {
    try {
      await db.execute(`
        UPDATE payments SET
          PaymentDate = NOW(),
          DigitalCurrencyAmount = ?,
          Currency = ?,
          AmountPaidInUSD = ?,
          CurrentRateToUSD = ?,
          Status = 'finished'
        WHERE OrderID = ?
      `, [
        payment.price_amount || null,
        payment.pay_currency || null,
        parseFloat(payment.pay_amount) || null,
        parseFloat(payment.pay_amount_usd_rate) || null,
        payment.OrderID
      ]);

      await db.execute(
        "UPDATE accounts SET CurrentBalance = CurrentBalance + ? WHERE UserID = ?",
        [parseFloat(payment.pay_amount) || 0, payment.UserID]
      );
    } catch (err) {
      console.error(`❌ Failed to update finished payment ${payment.PaymentID}:`, err.message);
    }
  }
}

module.exports = updatePendingPayments;

