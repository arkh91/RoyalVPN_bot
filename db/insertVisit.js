// db/insertVisit.js
const pool = require('../db');

async function insertVisit(userId) {
    const sql = `
        INSERT INTO visit (UserID)
        VALUES (?)
    `;
    try {
        await pool.execute(sql, [userId]);
        console.log(`Visit recorded for user ${userId}`);
    } catch (err) {
        console.error(`Visit insert failed for user ${userId}:`, err.message);
    }
}

module.exports = insertVisit;
