const db = require('../db');

async function getUserBalance(userId) {
    try {
        const [rows] = await db.query('SELECT CurrentBalance FROM accounts WHERE UserID = ?', [userId]);
        if (rows.length === 0) return 0;
        return parseFloat(rows[0].CurrentBalance) || 0;
    } catch (err) {
        console.error('Error fetching user balance:', err);
        return 0;
    }
}

module.exports = getUserBalance;

