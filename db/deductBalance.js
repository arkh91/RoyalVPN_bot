const db = require('../db');
const { columnFor } = require('../currency');

/**
 * Usage:
 *   await deductBalance(userId, 2.29);                // subtract USD from CurrentBalance - old behaviour
 *   await deductBalance(userId, 2000000, 'IRC');      // subtract Rial from accounts.IRC
 * Returns true when a row was updated, false otherwise.
 */
async function deductBalance(userId, amount, currency = 'USD') {
    const col = columnFor(currency); // whitelist lookup -> safe to interpolate; throws on unknown currency
    try {
        const [result] = await db.query(`UPDATE accounts SET ${col} = ${col} - ? WHERE UserID = ?`, [amount, userId]);
        return result.affectedRows > 0;
    } catch (err) {
        console.error('Error deducting balance:', err);
        return false;
    }
}

module.exports = deductBalance;
