const mysql = require('mysql2/promise');

// Set up DB connection (you can centralize this if preferred)
const dbConfig = {
    host: 'localhost',
    user: 'your_db_user',
    password: 'your_db_password',
    database: 'your_db_name'
};

async function insertUser(user) {
    const connection = await mysql.createConnection(dbConfig);

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
        await connection.execute(sql, values);
        console.log(`User ${user.id} inserted/updated.`);
    } catch (err) {
        console.error('Insert failed:', err.message);
    } finally {
        await connection.end();
    }
}

module.exports = insertUser;
