const axios = require('axios');
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'; // For testing only

// Map of server names to their URLs and API keys
const servers = {
    Ger: {
        apiUrl: '', // replace with actual URL
        apiKey: ''
    },
    Sweden82: {
        apiUrl: '', // replace with actual URL
        apiKey: ''
    },
    TUR14: {
        apiUrl: '', // replace with actual URL
        apiKey: ''
    },
    IRAN: {
        apiUrl: '', // replace with actual URL
        apiKey: ''
    },
    IT01: {
        apiUrl: '', // replace with actual URL
        apiKey: ''
    },
    US05: {
        apiUrl: '', // replace with actual URL
        apiKey: ''
    },
    UK36: {
        apiUrl: '', // replace with actual URL
        apiKey: ''
    }
};

// 10 GB limit in bytes
const DATA_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

// Main function to create a new access key
async function createNewKey(selectedServer) {
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

            // Set 10 GB limit (in bytes)
            await setKeyLimit(apiUrl, apiKey, accessKey.id);

            // Save updated URL with custom label as fragment (optional)
            const accessUrlWithLabel = accessKey.accessUrl + `#${customName}`;
            console.log(`✅ New access key created on ${selectedServer}: ${accessUrlWithLabel}`);
            console.log(`� Custom name (timestamp): ${customName}`);

            // Return the access URL
            return accessUrlWithLabel;

        } else {
            console.error('❌ Unexpected response:', response.status, response.data);
        }
    } catch (error) {
        handleError(error);
        throw error;
    }
}

// Set data limit on a key
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

// Timestamp formatter
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

// Error handler
function handleError(error) {
    if (error.response) {
        console.error('❌ API error:', error.response.status, error.response.data);
    } else {
        console.error('❌ Request error:', error.message);
    }
}

// Optional rename function (if used elsewhere)
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
            console.warn(`⚠️ Unexpected response during rename:`, response.status);
        }
    } catch (error) {
        console.error('❌ Rename failed:', error.response?.data || error.message);
    }
}

// Export the createNewKey function
module.exports = {
    createNewKey
};
