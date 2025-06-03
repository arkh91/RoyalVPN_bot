const axios = require('axios');
//const { URL } = require('url');

// Configuration - adjust these values for your servers
const SERVERS = {
    US05: {
        apiUrl: '', // Full API endpoint
        apiKey: '',
        aliases: ['test.com'] // All possible domain variations
    }
};

// Helper to validate Outline key format
function isValidOutlineKey(text) {
    return /^ss:\/\/[A-Za-z0-9+/=]+@[^:/?#]+:\d+/.test(text);
}

// Extract method, password, and server config from the Outline key
function extractKeyInfo(text) {
    const cleanUrl = text.split('#')[0]; // Remove tag if present
    const match = cleanUrl.match(/^ss:\/\/([A-Za-z0-9+/=]+)@([^:/?#]+):(\d+)/);

    if (!match) throw new Error("Invalid Outline key format.");

    const base64 = match[1];
    const host = match[2];

    let decoded;
    try {
        decoded = Buffer.from(base64, 'base64').toString(); // method:password
    } catch (err) {
        throw new Error("Failed to decode base64 credentials.");
    }

    const [method, password] = decoded.split(':');
    if (!method || !password) throw new Error("Invalid Shadowsocks credentials.");

    // Match host against aliases
    const [serverName, config] = Object.entries(SERVERS).find(([, conf]) =>
        conf.aliases.includes(host)
    ) || [];

    if (!config) throw new Error("Server not recognized.");

    return { config, method, password };
}

// Main function
async function getKeyStatusResponseMessage(text) {
    if (!isValidOutlineKey(text)) {
        throw new Error("❌ Invalid Outline key format.");
    }

    const { config, method, password } = extractKeyInfo(text);

    try {
        const url = `${config.apiUrl}${config.apiKey}/access-keys/`;

        const response = await axios.get(url);

        const key = response.data.accessKeys.find(k =>
            k.method === method && k.password === password
        );

        if (!key) {
            throw new Error("❌ Key not found on server.");
        }

        const usedMB = (key.usedBytes / 1024 / 1024).toFixed(2);
        const limitMB = key.dataLimit?.bytes
            ? (key.dataLimit.bytes / 1024 / 1024).toFixed(2)
            : '∞';

        return `✅ *Key Found!*\n� Used: *${usedMB} MB*\n� Limit: *${limitMB} MB*`;
    } catch (err) {
        throw new Error(`❌ Failed to fetch key data: ${err.message}`);
    }
}







module.exports = { getKeyStatusResponseMessage };
