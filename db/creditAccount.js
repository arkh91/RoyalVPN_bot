// db/creditAccount.js
const { columnFor } = require('../currency');
const { IRC_PER_USD } = require('../pricing');

/**
 * Adds funds to one wallet and records the matching row in `payments`,
 * both inside one transaction (all-or-nothing).
 *
 * Usage:
 *   const newBalance = await creditAccount(db, userId, 5, 'USD');          // +$5.00 to CurrentBalance
 *   const newBalance = await creditAccount(db, userId, 2000000, 'IRC');    // +2,000,000 Rial to accounts.IRC
 *   // `db` is the mysql2/promise pool from db.js. Returns the new balance (Number).
 *
 * payments row:
 *   USD -> exactly what the old commands wrote (Currency 'Rial', AmountPaidInUSD = amount).
 *   IRC -> Currency 'IRC', DigitalCurrencyAmount = Rial amount,
 *          AmountPaidInUSD = amount / IRC_PER_USD, CurrentRateToUSD = 1 / IRC_PER_USD.
 */
async function creditAccount(db, userId, amount, currency = 'USD') {
    const col = columnFor(currency); // whitelist lookup -> safe to interpolate

    const now = new Date();
    const pad = n => (n < 10 ? '0' + n : n);
    const ddmmyyyy = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}`;
    const hhmmss = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const orderId = `${ddmmyyyy}-${hhmmss}`;

    let row;
    if (currency === 'IRC') {
        row = {
            currencyName: 'IRC',
            digitalAmount: amount,
            usdAmount: Math.round((amount / IRC_PER_USD) * 100) / 100,
            rate: 1 / IRC_PER_USD,
            comment: 'Pending via TelegramBot (IRC)'
        };
    } else {
        row = { currencyName: 'Rial', digitalAmount: 0, usdAmount: amount, rate: 0, comment: 'Pending via TelegramBot' };
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(
            `INSERT INTO payments
             (UserID, PaymentDate, PaymentMethod, DigitalCurrencyAmount, Currency, AmountPaidInUSD, CurrentRateToUSD, Status, Comments, OrderID, PaymentID, invoiceID)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, now, 'Rial', row.digitalAmount, row.currencyName, row.usdAmount, row.rate, 'Pending', row.comment, orderId, orderId, orderId]
        );
        await conn.query(`UPDATE accounts SET ${col} = ${col} + ? WHERE UserID = ?`, [amount, userId]);
        const [rows] = await conn.query(`SELECT ${col} AS Balance FROM accounts WHERE UserID = ? LIMIT 1`, [userId]);
        await conn.commit();
        return Number(rows[0].Balance);
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = creditAccount;
