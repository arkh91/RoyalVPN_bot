const db = require('./db');

async function checkBalance(userId) {
  try {
    const [rows] = await db.query('SELECT CurrentBalance FROM accounts WHERE UserID = ?', [userId]);
    if (rows.length === 0) {
      return null; // user not found
    }
    return rows[0].CurrentBalance;
  } catch (error) {
    console.error('Error in checkBalance:', error);
    throw error;
  }
}

module.exports = checkBalance;
