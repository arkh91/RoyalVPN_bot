const db = require('../db');
const { columnFor } = require('../currency');

/**
 * Usage:
 *   const usd = await getUserBalance(userId);          // CurrentBalance (USD) - old behaviour
 *   const irc = await getUserBalance(userId, 'IRC');   // accounts.IRC (Rial)
 * Returns a Number (0 when the user is missing or on a DB error).
 */
async function getUserBalance(userId, currency = 'USD') {
    const col = columnFor(currency); // whitelist lookup -> safe to interpolate; throws on unknown currency
    try {
        const [rows] = await db.query(`SELECT ${col} AS Balance FROM accounts WHERE UserID = ?`, [userId]);
        if (rows.length === 0) return 0;
        return parseFloat(rows[0].Balance) || 0;
    } catch (err) {
        console.error('Error fetching user balance:', err);
        return 0;
    }
}

module.exports = getUserBalance;
