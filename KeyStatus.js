const axios = require('axios');
//const { URL } = require('url');
const SERVERS = require('./servers');


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

        // Parse usage
	console.log("DEBUG key =", JSON.stringify(key, null, 2));
        const usedBytes = parseFloat(key.usedBytes);
        const limitBytes = key.dataLimit?.bytes;

        const usedGB = isNaN(usedBytes)
            ? 'Unknown'
            : (usedBytes / 1024 / 1024 / 1024).toFixed(2);

        const limitGB = limitBytes
            ? (limitBytes / 1024 / 1024 / 1024).toFixed(2)
            : '∞';

        return `✅ *Key Found!*\n� Used: *${usedGB} GB*\n� Limit: *${limitGB} GB*`;

    } catch (err) {
        throw new Error(`❌ Failed to fetch key data: ${err.message}`);
    }
}

