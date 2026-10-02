const db = require('./db');
const { columnFor } = require('./currency');

/**
 * Usage:
 *   const usd = await checkBalance(userId);          // CurrentBalance (USD) - old behaviour
 *   const irc = await checkBalance(userId, 'IRC');   // accounts.IRC (Rial)
 * Returns the raw DB value, or null when the user is not found.
 */
async function checkBalance(userId, currency = 'USD') {
  const col = columnFor(currency); // whitelist lookup -> safe to interpolate
  try {
    const [rows] = await db.query(`SELECT ${col} AS Balance FROM accounts WHERE UserID = ?`, [userId]);
    if (rows.length === 0) {
      return null; // user not found
    }
    return rows[0].Balance;
  } catch (error) {
    console.error('Error in checkBalance:', error);
    throw error;
  }
}

module.exports = checkBalance;
