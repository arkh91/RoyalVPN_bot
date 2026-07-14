// getKeysUsage.js
//
// Usage:
//   const getKeysUsage = require('./getKeysUsage');
//   const usageMap = await getKeysUsage('DE01', SERVERS, axios, https);
//   const info = usageMap.get(GuiKey.trim()); // { bytes, limitBytes } or undefined
//
// Talks to a single Outline server's management API and returns a Map keyed
// by access-key name (both with and without a leading "#", since GuiKey is
// sometimes stored either way) whose value is { bytes, limitBytes }:
//   - bytes:      total bytes transferred by that key (from /metrics/transfer)
//   - limitBytes: the key's configured data limit in bytes, or null if unlimited
//
// Why two API calls instead of one per key:
//   Outline's /access-keys endpoint lists key metadata (name -> id, dataLimit)
//   but NOT usage. Its /metrics/transfer endpoint returns usage keyed by id
//   but NOT names. We fetch both once per server and join them locally,
//   instead of hitting the API once per key (which would be N calls per
//   /ks invocation instead of 2).
//
// Requires the server to have metrics reporting enabled (the default for
// Outline servers installed via the standard install script). If metrics
// are disabled, /metrics/transfer will simply return no data and every key
// will show 0 bytes used.

async function getKeysUsage(serverName, SERVERS, axios, https) {
    const server = SERVERS[serverName];
    if (!server) {
        throw new Error(`Server config not found for: ${serverName}`);
    }

    let baseUrl = server.apiUrl || server.baseUrl || server.api;
    if (!baseUrl.endsWith('/')) baseUrl += '/';

    // Outline's self-signed cert -> same rejectUnauthorized:false pattern
    // already used elsewhere in this codebase (e.g. /removekey).
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    // 1) List access keys: gives us id, name, and any configured dataLimit
    const keysUrl = `${baseUrl}${server.apiKey}/access-keys`;
    const keysResp = await axios.get(keysUrl, { httpsAgent, timeout: 15000 });
    const accessKeys = keysResp.data && keysResp.data.accessKeys
        ? keysResp.data.accessKeys
        : (Array.isArray(keysResp.data) ? keysResp.data : []);

    // 2) Fetch transfer metrics: { bytesTransferredByUserId: { "<id>": bytes, ... } }
    const metricsUrl = `${baseUrl}${server.apiKey}/metrics/transfer`;
    const metricsResp = await axios.get(metricsUrl, { httpsAgent, timeout: 15000 });
    const bytesByUserId = (metricsResp.data && metricsResp.data.bytesTransferredByUserId) || {};

    // 3) Join by id -> build a name-based lookup map
    const usageMap = new Map();

    for (const k of accessKeys) {
        if (!k || typeof k.name !== 'string' || !k.name.trim()) continue;

        const id = k.id ?? k.keyId ?? k.accessKeyId;
        const bytes = (id !== undefined && bytesByUserId[id] !== undefined)
            ? bytesByUserId[id]
            : 0;
        const limitBytes = (k.dataLimit && typeof k.dataLimit.bytes === 'number')
            ? k.dataLimit.bytes
            : null;

        const info = { bytes, limitBytes };

        const trimmed = k.name.trim();
        const withHash = trimmed.startsWith('#') ? trimmed : ('#' + trimmed);
        const withoutHash = trimmed.startsWith('#') ? trimmed.substring(1).trim() : trimmed;

        // Store both variants since GuiKey in the DB may or may not include "#"
        usageMap.set(withHash, info);
        usageMap.set(withoutHash, info);
    }

    return usageMap;
}

// Usage:
//   formatBytes(1234567890) -> "1.15 GB"
//   formatBytes(0)          -> "0 MB"
//
// Small display helper: turns a raw byte count into a human-readable
// MB/GB string for chat output.
/*
function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
}*/
function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    const mb = bytes / (1000 * 1000);
    if (mb < 1000) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1000).toFixed(2)} GB`;
}
module.exports = { getKeysUsage, formatBytes };
