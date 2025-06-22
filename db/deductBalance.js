const db = require('../db');

async function deductBalance(userId, amount) {
    try {
        await db.query('UPDATE accounts SET CurrentBalance = CurrentBalance - ? WHERE UserID = ?', [amount, userId]);
    } catch (err) {
        console.error('Error deducting balance:', err);
    }
}

module.exports = deductBalance;
