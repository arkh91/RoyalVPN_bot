// db/WGKeyCreation.js
const axios = require('axios');
const crypto = require('crypto');
const pool = require('../db'); // path to db.js (mysql2/promise pool)

// ──────────────────────────────────────────────────────────────
// X25519 public-key derivation from a raw WireGuard private key.
//
// WireGuard keys are raw 32-byte X25519 keys, base64-encoded.
// The /create endpoint (see install-wg.sh -> server.js) only ever
// returns the *private* key in the rendered client config — it
// never hands back the client's own public key as a separate
// value. Since wg_clients.public_key is NOT NULL UNIQUE, we
// derive it ourselves rather than depending on the `wg` CLI being
// installed on the bot host. This is exactly what `wg pubkey` does
// internally (scalar multiplication against the Curve25519 base
// point) — not a guess, just the same math.
// ──────────────────────────────────────────────────────────────

// Fixed ASN.1 prefixes for wrapping/unwrapping raw X25519 keys via Node's crypto module.
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex'); // 16 bytes + 32-byte key = 48
const X25519_SPKI_KEY_LEN = 32;

function derivePublicKeyFromPrivate(privateKeyBase64) {
    const privRaw = Buffer.from(privateKeyBase64, 'base64');
    if (privRaw.length !== 32) {
        throw new Error(`Unexpected private key length: ${privRaw.length} bytes`);
    }

    const pkcs8Der = Buffer.concat([X25519_PKCS8_PREFIX, privRaw]);
    const privateKeyObject = crypto.createPrivateKey({
        key: pkcs8Der,
        format: 'der',
        type: 'pkcs8'
    });

    const publicKeyObject = crypto.createPublicKey(privateKeyObject);
    const spkiDer = publicKeyObject.export({ type: 'spki', format: 'der' });
    const rawPublicKey = spkiDer.subarray(spkiDer.length - X25519_SPKI_KEY_LEN);

    return rawPublicKey.toString('base64');
}

// ──────────────────────────────────────────────────────────────
// Parse the plain-text WireGuard client config returned by /create
// (Content-Type: text/plain — confirmed against install-wg.sh's
// server.js and a live response from the Germany node).
// ──────────────────────────────────────────────────────────────
function parseClientConfigText(rawText) {
    const parts = rawText.split('[Peer]');
    if (parts.length < 2) {
        throw new Error('Unexpected /create response format (no [Peer] section found)');
    }

    const interfacePart = parts[0];
    const peerPart = parts[1];

    const privateKeyMatch = interfacePart.match(/PrivateKey\s*=\s*(\S+)/);
    const addressMatch = interfacePart.match(/Address\s*=\s*(\S+)/);   // e.g. "10.66.66.3/32"
    const dnsMatch = interfacePart.match(/DNS\s*=\s*(\S+)/);
    const serverPubKeyMatch = peerPart.match(/PublicKey\s*=\s*(\S+)/);
    const endpointMatch = peerPart.match(/Endpoint\s*=\s*(\S+)/);
    const allowedIpsMatch = peerPart.match(/AllowedIPs\s*=\s*(\S+)/);  // e.g. "0.0.0.0/0"

    if (!privateKeyMatch || !addressMatch) {
        throw new Error('Unexpected /create response format (missing PrivateKey or Address)');
    }

    return {
        privateKey: privateKeyMatch[1],
        address: addressMatch[1],                                     // client's assigned IP, e.g. "10.66.66.3/32"
        dns: dnsMatch ? dnsMatch[1] : null,
        serverPublicKey: serverPubKeyMatch ? serverPubKeyMatch[1] : null,
        endpoint: endpointMatch ? endpointMatch[1] : null,
        allowedIps: allowedIpsMatch ? allowedIpsMatch[1] : '0.0.0.0/0',
        rawConfig: rawText.trim()
    };
}

function handleError(error, context) {
    if (error.response) {
        console.error(`❌ WG API error [${context}]:`, error.response.status, error.response.data);
    } else {
        console.error(`❌ WG request error [${context}]:`, error.message);
    }
}

// ──────────────────────────────────────────────────────────────
// Look up a vpn_servers row by its ServerAlias (e.g. "Ger27").
// ──────────────────────────────────────────────────────────────
async function getServerByAlias(serverAlias) {
    const [rows] = await pool.execute(
        `SELECT ServerName, ServerAlias, Country, City,
                PublicURLInternational, PublicURLIran,
                WireGuardPort, BearerToken, Status
         FROM vpn_servers
         WHERE ServerAlias = ?
         LIMIT 1`,
        [serverAlias]
    );

    if (!rows || rows.length === 0) {
        throw new Error(`No vpn_servers row found for ServerAlias "${serverAlias}"`);
    }

    const server = rows[0];
    if (server.Status !== 'ACTIVE') {
        throw new Error(`Server "${serverAlias}" is not ACTIVE (status: ${server.Status})`);
    }

    return server;
}
/*
// ──────────────────────────────────────────────────────────────
// Call /create once against the chosen server and return the
// parsed peer info (does NOT touch the DB).
// ──────────────────────────────────────────────────────────────
async function requestNewPeer(server, isInternational) {
    let baseUrl = isInternational ? server.PublicURLInternational : server.PublicURLIran;
    if (!baseUrl) {
        throw new Error(`Server "${server.ServerAlias}" has no ${isInternational ? 'PublicURLInternational' : 'PublicURLIran'} configured`);
    }
    if (!server.BearerToken) {
        throw new Error(`Server "${server.ServerAlias}" has no BearerToken configured`);
    }

    // PublicURLInternational / PublicURLIran are stored as bare hostnames
    // (e.g. "us.us08dir.mithracorp.com"), no scheme — axios needs an absolute URL.
    if (!/^https?:\/\//i.test(baseUrl)) {
        baseUrl = `https://${baseUrl}`;
    }

    const createUrl = `${baseUrl.replace(/\/$/, '')}/create`;

    let response;
    try {
        response = await axios.post(createUrl, {}, {
            headers: {
                Authorization: `Bearer ${server.BearerToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
    } catch (error) {
        handleError(error, 'requestNewPeer');
        throw error;
    }

    const parsed = parseClientConfigText(
        typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    );

    const publicKey = derivePublicKeyFromPrivate(parsed.privateKey);

    return {
        privateKey: parsed.privateKey,
        publicKey,
        address: parsed.address,              // e.g. "10.66.66.3/32"
        dns: parsed.dns,                       // e.g. "1.1.1.1"
        allowedIps: parsed.allowedIps,         // e.g. "0.0.0.0/0"
        serverPublicKey: parsed.serverPublicKey,
        endpoint: parsed.endpoint,
        rawConfig: parsed.rawConfig
    };
}
*/
async function requestNewPeer(server, isInternational) {
    // Always call the management API over the international hostname —
    // PublicURLIran is the client-facing tunnel endpoint, not reachable
    // (or not meant) for the /create API call itself.
    let apiBaseUrl = server.PublicURLInternational;
    if (!apiBaseUrl) {
        throw new Error(`Server "${server.ServerAlias}" has no PublicURLInternational configured`);
    }
    if (!server.BearerToken) {
        throw new Error(`Server "${server.ServerAlias}" has no BearerToken configured`);
    }

    if (!/^https?:\/\//i.test(apiBaseUrl)) {
        apiBaseUrl = `https://${apiBaseUrl}`;
    }

    const createUrl = `${apiBaseUrl.replace(/\/$/, '')}/create`;

    let response;
    try {
        response = await axios.post(createUrl, {}, {
            headers: {
                Authorization: `Bearer ${server.BearerToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
    } catch (error) {
        handleError(error, 'requestNewPeer');
        throw error;
    }

    const parsed = parseClientConfigText(
        typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    );

    const publicKey = derivePublicKeyFromPrivate(parsed.privateKey);

    // The Endpoint the *user* connects to is independent of which host
    // we used to call /create. Pick it based on isInternational, and
    // override whatever the server returned in its own config text.
    const tunnelHost = isInternational ? server.PublicURLInternational : server.PublicURLIran;
    if (!tunnelHost) {
        throw new Error(`Server "${server.ServerAlias}" has no ${isInternational ? 'PublicURLInternational' : 'PublicURLIran'} configured for the tunnel endpoint`);
    }

    const endpoint = `${tunnelHost}:${server.WireGuardPort}`;

    // Rewrite the Endpoint line in the raw config text so what the user
    // pastes/imports matches `endpoint` exactly.
    const rewrittenConfig = parsed.rawConfig.replace(
        /Endpoint\s*=\s*\S+/,
        `Endpoint = ${endpoint}`
    );

    return {
        privateKey: parsed.privateKey,
        publicKey,
        address: parsed.address,
        dns: parsed.dns,
        allowedIps: parsed.allowedIps,
        serverPublicKey: parsed.serverPublicKey,
        endpoint,
        rawConfig: rewrittenConfig
    };
}
// ──────────────────────────────────────────────────────────────
// Insert one row into wg_clients, matching the real schema exactly:
// client_id, UserID, name, description, server_name, private_key,
// public_key, address, dns, allowed_ips, endpoint, is_active,
// expires_at, max_data_limit. (rx_bytes/tx_bytes/snapshots/etc. are
// left at their column defaults — usage tracking is handled
// elsewhere, per your earlier note.)
// ──────────────────────────────────────────────────────────────
async function saveClientToDB({ userId, serverName, name, description, peer, maxDataLimit, validDays }) {
    const sql = `
        INSERT INTO wg_clients
            (UserID, name, description, server_name,
             private_key, public_key, address, dns, allowed_ips, endpoint,
             is_active, expires_at, max_data_limit, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW() + INTERVAL ? DAY, ?, ?)
    `;

    const values = [
        userId,
        name,
        description,
        serverName,
        peer.privateKey,
        peer.publicKey,
        peer.address,
        peer.dns,
        peer.allowedIps,
        peer.endpoint,
        validDays,
        maxDataLimit,
        'telegram_bot'
    ];

    const [result] = await pool.execute(sql, values);
    return result.insertId;
}

/**
 * Create one or more WireGuard peers for a user's purchase.
 *
 * @param {Object} opts
 * @param {string} opts.serverAlias   e.g. "Ger27" — looked up against vpn_servers.ServerAlias
 * @param {number} opts.userId        Telegram user ID
 * @param {number} opts.deviceCount   number of peers to create (e.g. 1, 2, 3)
 * @param {number} opts.bandwidthGb   selected bandwidth tier in GB (stored as max_data_limit bytes —
 *                                    enforcement is handled elsewhere per your note)
 * @param {boolean} opts.isInternational  true = use PublicURLInternational, false = PublicURLIran
 *                                        (mirrors the Outline flow's session.isInternational flag)
 * @param {number} [opts.validDays=30]
 *
 * @returns {Promise<Array<{deviceSeq:number, clientId:number, address:string, config:string}>>}
 */
async function createWireGuardKeys({ serverAlias, userId, deviceCount, bandwidthGb, isInternational, validDays = 30 }) {
    if (!serverAlias) throw new Error('serverAlias is required');
    if (!deviceCount || deviceCount < 1) throw new Error('deviceCount must be >= 1');

    const server = await getServerByAlias(serverAlias);

    // Same byte convention KeyCreation.js (Outline) uses for "GB":
    //const maxDataLimit = bandwidthGb * 1024 * 1024 * 1000;

// Total purchased bandwidth is split evenly across devices —
// e.g. 50GB / 2 devices = 25GB cap per peer.
const perDeviceGb = bandwidthGb / deviceCount;
const maxDataLimit = perDeviceGb * 1024 * 1024 * 1000;

    const timestamp = Date.now();
    const results = [];

    for (let deviceSeq = 1; deviceSeq <= deviceCount; deviceSeq++) {
        const peer = await requestNewPeer(server, isInternational);

        const name = `${server.ServerName}_${timestamp}_dev${deviceSeq}`;

        const clientId = await saveClientToDB({
            userId,
            serverName: server.ServerName,
            name,
            description: 'Created via Telegram bot purchase',
            peer,
            maxDataLimit,
            validDays
        });

        console.log(`✅ WG client created: user=${userId} server=${server.ServerName} client_id=${clientId} (device ${deviceSeq}/${deviceCount})`);

        results.push({
            deviceSeq,
            clientId,
            address: peer.address,
            config: peer.rawConfig
        });
    }

    return results;
}

module.exports = {
    createWireGuardKeys
};
