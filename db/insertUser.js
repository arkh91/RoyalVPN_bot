// insertUser.js
const pool = require('../db'); // path to db.js

async function insertUser(user) {
    const sql = `
        INSERT INTO accounts (UserID, FirstName, LastName, Username)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            FirstName = VALUES(FirstName),
            LastName = VALUES(LastName),
            Username = VALUES(Username);
    `;

    const values = [
        user.id,
        user.first_name || '',
        user.last_name || '',
        user.username || ''
    ];

    try {
        await pool.execute(sql, values);
//        console.log(
//    `User inserted/updated: ID=${user.id}, FirstName="${user.first_name || ''}", LastName="${user.last_name || ''}", Username="${user.username || ''}"`
//);
console.log(
    `[${new Date().toISOString()}] User inserted/updated: ID=${user.id}, FirstName="${user.first_name || ''}", LastName="${user.last_name || ''}", Username="${user.username || ''}"`
);

    } catch (err) {
        console.error('Insert failed:', err.message);
    }
}

module.exports = insertUser;
