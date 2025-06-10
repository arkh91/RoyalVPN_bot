const pool = require('../db'); // path to db.js
const axios = require('axios');
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'; // For testing only
const servers = require ('../servers');

const DATA_LIMIT_BYTES = 1 * 1024 * 1024 * 1024;

async function createNewKey(selectedServer, userId) {
    const { apiUrl, apiKey } = servers[selectedServer];
    if (!apiUrl || !apiKey) {
        throw new Error(`Missing API URL or key for server: ${selectedServer}`);
    }

    try {
        const response = await axios.post(
            `${apiUrl}/${apiKey}/access-keys`,
            {},
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-outline-access-key': apiKey,
                },
            }
        );

        if (response.status === 201) {
            const accessKey = response.data;
            const timestampName = getTimestampName();
            const customName = `${selectedServer}_${timestampName}`;

            // Rename key on server
            await axios.put(
                `${apiUrl}/${apiKey}/access-keys/${accessKey.id}/name`,
                { name: customName },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-outline-access-key': apiKey,
                    },
                }
            );

            // Set 10 GB limit
            await setKeyLimit(apiUrl, apiKey, accessKey.id);

            const accessUrlWithLabel = `${accessKey.accessUrl}#${customName}`;
            console.log(`✅ New access key created on ${selectedServer}: ${accessUrlWithLabel}`);
            console.log(`� Custom name(timestamp): ${customName}`);

            await KeyToDB({
                userId,
                fullKey: accessUrlWithLabel,
                guiKey: `#${customName}`,
                serverName: selectedServer,
                //dataLimit: DATA_LIMIT_BYTES,
                dataLimit: DATA_LIMIT_BYTES / (1024 * 1024 * 1024), // Convert to GB
		keyNumber: timestampName
            });

            return accessUrlWithLabel;
        } else {
            console.error('❌ Unexpected response:', response.status, response.data);
            return null;
        }
    } catch (error) {
        handleError(error);
        throw error;
    }
}

async function setKeyLimit(apiUrl, apiKey, keyId) {
    try {
        const response = await axios.put(
            `${apiUrl}/${apiKey}/access-keys/${keyId}/data-limit`,
            { limit: { bytes: DATA_LIMIT_BYTES } },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-outline-access-key': apiKey,
                },
            }
        );

        if (response.status === 204) {
            console.log(`� Data limit of 10 GB set for key ID: ${keyId}`);
        } else {
            console.error('❌ Failed to set data limit:', response.status, response.data);
        }
    } catch (error) {
        handleError(error);
    }
}

function getTimestampName() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${mm}${dd}${yyyy}_${hh}${min}${ss}`;
}

function handleError(error) {
    if (error.response) {
        console.error('❌ API error:', error.response.status, error.response.data);
    } else {
        console.error('❌ Request error:', error.message);
    }
}

async function renameKey(apiUrl, apiKey, keyId, customName) {
    try {
        const response = await axios.put(
            `${apiUrl}/${apiKey}/access-keys/${keyId}/name`,
            { name: customName },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-outline-access-key': apiKey,
                },
            }
        );

        if (response.status === 204) {
            console.log(`✏️  Key ${keyId} renamed to "${customName}"`);
        } else {
            console.warn('⚠️ Unexpected response during rename:', response.status);
        }
    } catch (error) {
        console.error('❌ Rename failed:', error.response?.data || error.message);
    }
}

async function KeyToDB({ userId, fullKey, guiKey, serverName, dataLimit, keyNumber }) {
    const issuedAt = new Date();
    const expiredAt = new Date(issuedAt);
    expiredAt.setDate(expiredAt.getDate() + 30);
console.log('🔍 KeyToDB values:', {
    userId,
    fullKey,
    guiKey,
    serverName,
    dataLimit,
    keyNumber,
    issuedAt,
    expiredAt
});

    const sql = `
        INSERT INTO UserKeys 
            (UserID, FullKey, GuiKey, ServerName, DataLimit, KeyNumber, IssuedAt, ExpiredAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        userId,
        fullKey,
        guiKey,
        serverName,
        dataLimit,
        keyNumber,
        issuedAt,
        expiredAt
    ];

    try {
        await pool.execute(sql, values);
        console.log('�️ Key saved to database.');
    } catch (err) {
        console.error('❌ Failed to insert key into DB:', err.message);
    }
}

module.exports = {
    createNewKey
};
