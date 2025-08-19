const pool = require('../db'); // path to db.js
const axios = require('axios');
const servers = require('../servers');
const flags = require('./flags');

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'; // For local/test only

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

async function setKeyLimit(apiUrl, apiKey, keyId, dataLimitBytes) {
    try {
        const response = await axios.put(
            `${apiUrl}/${apiKey}/access-keys/${keyId}/data-limit`,
            { limit: { bytes: dataLimitBytes } },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-outline-access-key': apiKey,
                },
            }
        );

        if (response.status === 204) {
            console.log(`✅ Data limit set to ${dataLimitBytes / 1024 ** 3} GB for key ${keyId}`);
        } else {
            console.warn('⚠️ Unexpected response during limit set:', response.status);
        }
    } catch (error) {
        handleError(error);
    }
}

async function renameKey(apiUrl, apiKey, keyId, baseName) {
    try {
        // Match flag by prefix (case-insensitive)
        const prefix = Object.keys(flags).find(key =>
            baseName.toUpperCase().startsWith(key.toUpperCase())
        );
        const flag = prefix ? ` ${flags[prefix]}` : '';
        const renamed = baseName + flag;

        const response = await axios.put(
            `${apiUrl}/${apiKey}/access-keys/${keyId}/name`,
            { name: renamed },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-outline-access-key': apiKey,
                },
            }
        );

        if (response.status === 204) {
            console.log(`✏️  Key ${keyId} renamed to "${renamed}"`);
            return renamed;
        } else {
            console.warn('⚠️ Rename responded with:', response.status);
            return baseName;
        }
    } catch (error) {
        handleError(error);
        return baseName;
    }
}

async function saveKeyToDB({ userId, fullKey, guiKey, serverName, dataLimit, keyNumber }) {
    const issuedAt = new Date();
    const expiredAt = new Date(issuedAt);
    expiredAt.setDate(expiredAt.getDate() + 30);

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
        console.log('✅ Key saved to database.');
    } catch (err) {
        console.error('❌ Failed to save key to DB:', err.message);
    }
}

async function createNewKey(selectedServer, userId, bandwidthGb = 1) {
    const { apiUrl, apiKey } = servers[selectedServer];
    if (!apiUrl || !apiKey) {
        throw new Error(`Missing API credentials for server: ${selectedServer}`);
    }

    const dataLimitBytes = bandwidthGb * 1024 * 1024 * 1000;

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

        if (response.status !== 201) {
            console.error('❌ Failed to create key:', response.status);
            return null;
        }

        const accessKey = response.data;
        const timestamp = getTimestampName();
        const baseName = `${selectedServer}_${timestamp}`;

        const renamed = await renameKey(apiUrl, apiKey, accessKey.id, baseName);
        await setKeyLimit(apiUrl, apiKey, accessKey.id, dataLimitBytes);

        const accessUrlWithLabel = `${accessKey.accessUrl}#${renamed}`;
        // Remove '/?outline=1' from the URL
        const cleanedKey = accessUrlWithLabel.replace('/?outline=1', '');

        console.log(`✅ New access key created: ${cleanedKey}`); 

        await saveKeyToDB({
            userId,
	        fullKey: cleanedKey,
            guiKey: `#${renamed}`,
            serverName: selectedServer,
            dataLimit: bandwidthGb,
            keyNumber: timestamp
        });

        return cleanedKey;
    } catch (error) {
        handleError(error);
        throw error;
    }
}

module.exports = {
    createNewKey
};
