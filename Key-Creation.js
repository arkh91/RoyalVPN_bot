

const axios = require('axios');
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'; // For testing only

// Map of server names to their URLs and API keys
const servers = {
    TUR14   : {
        apiUrl: '', // replace with actual URL
        apiKey: ''
    },
    UK36: {
        apiUrl: '', // replace with actual URL
        apiKey: ''
    }
};

// Choose server here
const selectedServer = 'UK36'; // change to 'S82' or others as needed
const { apiUrl, apiKey } = servers[selectedServer];

// 10 GB limit in bytes
const DATA_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

async function createNewKey() {
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
            await setKeyLimit(accessKey.id);

            // Save updated URL with custom label as fragment (optional)
            const accessUrlWithLabel = accessKey.accessUrl + `#${customName}`;
            console.log(`✅ New access key created on ${selectedServer}: ${accessUrlWithLabel}`);
            console.log(`🔖 Custom name (timestamp): ${customName}`);

        } else {
            console.error('❌ Unexpected response:', response.status, response.data);
        }
    } catch (error) {
        handleError(error);
    }
}


async function setKeyLimit(keyId) {
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
            console.log(`📶 Data limit of 10 GB set for key ID: ${keyId}`);
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
            console.warn(`⚠️ Unexpected response during rename:`, response.status);
        }
    } catch (error) {
        console.error('❌ Rename failed:', error.response?.data || error.message);
    }
}

createNewKey();
