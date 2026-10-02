/*
const axios = require('axios');
const db = require('./db');
const { NOWPAYMENTS_API_KEY } = require('./token');

async function getNowPaymentsStatus(userId) {
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
      if (!payment.PaymentID) continue;

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

      if (['finished', 'confirmed'].includes(paymentData.payment_status)) {
        // 1. Update the payment record
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
            'Payment completed and balance updated',
            payment.PaymentID
          ]
        );

        // 2. Update user's balance in accounts table
        await db.execute(
          `UPDATE accounts 
           SET CurrentBalance = CurrentBalance + ?
           WHERE UserID = ?`,
          [paymentData.price_amount, userId]
        );

        completedPayments.push({
          dbRecord: payment,
          apiData: paymentData
        });
      }

    } catch (error) {
      if (error.response?.status === 404) {
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
*/

/*
const axios = require('axios');
const { NOWPAYMENTS_API_KEY } = require('./token');

async function getNowPaymentsStatus(orderId) {
    try {
        // First try to find payment by order_id in the list of all payments
        const paymentsResponse = await axios.get(
            'https://api.nowpayments.io/v1/payment',
            {
                headers: {
                    'x-api-key': NOWPAYMENTS_API_KEY,
                    'Content-Type': 'application/json'
                },
                params: {
                    limit: 100, // Adjust based on expected number of payments
                    page: 0
                }
            }
        );

        // Find payment with matching order_id
        const payment = paymentsResponse.data.data.find(
            p => p.order_id === orderId
        );

        if (!payment) {
            return { status: 'not_found', orderId };
        }

        // Now get detailed status
        const detailResponse = await axios.get(
            `https://api.nowpayments.io/v1/payment/${payment.payment_id}`,
            {
                headers: {
                    'x-api-key': NOWPAYMENTS_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        const paymentData = detailResponse.data;

        return {
    		status: paymentData.payment_status,
    		orderId: paymentData.order_id,
    		paymentId: paymentData.payment_id,
    		amountPaid: paymentData.actually_paid,
    		currency: paymentData.pay_currency,
    		usdValue: paymentData.price_amount,
    		invoiceid: paymentData.invoice_id
	};


    } catch (error) {
        console.error('NowPayments API Error:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
        return { status: 'error', orderId };
    }
}

// getNowPaymentsStatus.js
const npClient = require("./npClient");

async function getNowPaymentsStatus(paymentId) {
  try {
    const { data } = await npClient.get(`/payment/${paymentId}`);
    return data;
  } catch (error) {
    console.error("❌ Error fetching NowPayments status:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    return null;
  }
}

module.exports = getNowPaymentsStatus;
*/

// getNowPaymentsInvoiceStatus.js
const npClient = require("./npClient");

async function getNowPaymentsInvoiceStatus(invoiceId) {
  try {
    const { data } = await npClient.get(`/invoice/${invoiceId}`);
    return data;
  } catch (error) {
    console.error("❌ Error fetching NowPayments invoice status:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    return null;
  }
}

module.exports = getNowPaymentsInvoiceStatus;
//module.exports = getNowPaymentsStatus;
