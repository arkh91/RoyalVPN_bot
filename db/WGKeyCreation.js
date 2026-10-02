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
// Look up a vpn_servers row by its ServerAlias (e.g. "Ger27"),
// joined against `countries` (on countries.CountryName ==
// vpn_servers.Country) so we get the matching flag emoji in the
// same query — no separate lookup or hard-coded flag map needed.
//
// Usage:
//   const server = await getServerByAlias('Ger28');
//   // server.CountryFlag -> '🇩🇪'  (or '' if vpn_servers.Country
//   //                                doesn't match any CountryName)
//   // server.DNS -> '1.1.1.1,1.0.0.1,8.8.8.8,8.8.4.4' (raw column value)
// ──────────────────────────────────────────────────────────────
async function getServerByAlias(serverAlias) {
    const [rows] = await pool.execute(
        `SELECT vs.ServerName, vs.ServerAlias, vs.Country, vs.City,
                vs.PublicURLInternational, vs.PublicURLIran,
                vs.WireGuardPort, vs.BearerToken, vs.Status, vs.DNS,
                c.FlagEmoji AS CountryFlag
         FROM vpn_servers vs
         LEFT JOIN countries c ON c.CountryName = vs.Country
         WHERE vs.ServerAlias = ?
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

    // LEFT JOIN means no match (or a NULL FlagEmoji) comes back as NULL —
    // normalize to '' so callers can always safely concatenate it.
    server.CountryFlag = server.CountryFlag || '';

    return server;
}

// Fallback used only if vpn_servers.DNS is somehow empty/NULL for a
// server (shouldn't happen — the column is NOT NULL with this same
// default — but this keeps key issuing from failing outright if it does).
const DEFAULT_DNS = '1.1.1.1,1.0.0.1,8.8.8.8,8.8.4.4';

/**
 * Turns vpn_servers.DNS ("1.1.1.1,1.0.0.1,8.8.8.8,8.8.4.4", comma-separated,
 * no spaces required) into the form a WireGuard config's DNS line expects
 * ("1.1.1.1, 1.0.0.1, 8.8.8.8, 8.8.4.4").
 *
 * Usage:
 *   formatDnsForConfig('1.1.1.1,1.0.0.1')  // -> '1.1.1.1, 1.0.0.1'
 *   formatDnsForConfig('')                 // -> DEFAULT_DNS, reformatted
 */
function formatDnsForConfig(dnsCsv) {
    const list = String(dnsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
    return (list.length > 0 ? list : DEFAULT_DNS.split(',')).join(', ');
}

/**
 * Overrides the DNS the *server* put in a freshly-created peer's config
 * with the DNS configured for that server in the database — same idea as
 * the Endpoint rewrite in requestNewPeer() just below. If the server's
 * response had no "DNS = " line at all, one is inserted right after
 * "Address = ", inside the same [Interface] section.
 *
 * Usage:
 *   const peer = applyServerDns(rawPeer, server.DNS); // peer.dns + peer.rawConfig both updated
 */
function applyServerDns(peer, dnsCsv) {
    const dnsLine = formatDnsForConfig(dnsCsv);
    let rawConfig = peer.rawConfig;

    if (/^DNS\s*=\s*\S+/m.test(rawConfig)) {
        rawConfig = rawConfig.replace(/^DNS\s*=\s*\S+.*$/m, `DNS = ${dnsLine}`);
    } else {
        rawConfig = rawConfig.replace(/^(Address\s*=\s*\S+.*)$/m, `$1\nDNS = ${dnsLine}`);
    }

    return { ...peer, dns: dnsLine, rawConfig };
}

// ──────────────────────────────────────────────────────────────
// Formats a Date as MMDDYYYY_HHMMSS for building human-readable
// WireGuard client names, e.g. "08272026_132655".
//
// Usage:
//   formatNameTimestamp(new Date()) // -> "09262026_143012"
// ──────────────────────────────────────────────────────────────
function formatNameTimestamp(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const yyyy = date.getFullYear();
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${mm}${dd}${yyyy}_${hh}${min}${ss}`;
}

/**
 * Formats a Date as MMDDYYYY only (no time) — used for the .conf
 * FILENAME, which needs to stay short and plain: no seconds, no flag
 * emoji, no "#". WireGuard's importer on Android (and some desktop
 * clients) fails to import a config, or mangles the profile name, if
 * the filename has emoji/"#"/unexpected punctuation in it.
 *
 * Usage:
 *   formatFileDate(new Date()) // -> "09262026"
 */
function formatFileDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const yyyy = date.getFullYear();
    return `${mm}${dd}${yyyy}`;
}

/**
 * Builds a short, WireGuard-import-safe FILENAME (no extension) for
 * the .conf attachment: "<alias>_<MMDDYYYY>", with "_<deviceSeq>"
 * appended only when more than one device was purchased in this call.
 * Kept completely separate from `name` (the value written to
 * wg_clients.name and shown in the Telegram caption), which keeps its
 * full HHMMSS timestamp and flag — those aren't wanted in the file.
 *
 * The official WireGuard apps (Android/iOS/desktop) derive the
 * tunnel's interface name from the file's basename and REQUIRE it to
 * match ^[a-zA-Z0-9_=+.-]{1,15}$ — max 15 characters, no emoji, no
 * "#", no spaces. That's exactly why the earlier
 * "#uk42_09262026_023732🇬🇧.conf" filename failed to import: the "#",
 * the emoji, and the length all violate it. If alias+date+suffix
 * would still run over 15 chars (e.g. a longer alias like "Thai02"
 * plus a device suffix), the ALIAS is trimmed, not the date/suffix,
 * since the date and device number are what you actually asked to
 * see in the filename.
 *
 * Usage:
 *   buildFileName('uk42', new Date('2026-09-26'), 1, 1) // -> "uk42_09262026"
 *   buildFileName('uk42', new Date('2026-09-26'), 1, 2) // -> "uk42_09262026_1"
 *   buildFileName('uk42', new Date('2026-09-26'), 2, 2) // -> "uk42_09262026_2"
 */
function buildFileName(serverAlias, date, deviceSeq, deviceCount) {
    const safeAlias = serverAlias.replace(/[^a-zA-Z0-9_=+.-]/g, '');
    const dateStr = formatFileDate(date);
    const suffix = deviceCount > 1 ? `_${deviceSeq}` : '';

    let fileName = `${safeAlias}_${dateStr}${suffix}`;

    if (fileName.length > 15) {
        const fixedPart = `_${dateStr}${suffix}`;
        const maxAliasLen = Math.max(15 - fixedPart.length, 0);
        fileName = `${safeAlias.slice(0, maxAliasLen)}${fixedPart}`;
    }

    return fileName;
}

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

    const peerWithEndpoint = {
        privateKey: parsed.privateKey,
        publicKey,
        address: parsed.address,
        dns: parsed.dns,
        allowedIps: parsed.allowedIps,
        serverPublicKey: parsed.serverPublicKey,
        endpoint,
        rawConfig: rewrittenConfig
    };

    // DNS the customer's device will use comes from OUR database
    // (vpn_servers.DNS), not from whatever the WireGuard server itself
    // returned — same reasoning as the Endpoint override above.
    return applyServerDns(peerWithEndpoint, server.DNS);
}
// ──────────────────────────────────────────────────────────────
// Insert one row into wg_clients, matching the real schema exactly:
// client_id, UserID, name, description, server_name, private_key,
// public_key, address, dns, allowed_ips, endpoint, is_active,
// expires_at, max_data_limit, notes. There is NO "config" column —
// the full .conf text is reconstructed on demand from these same
// columns (private_key, address, dns, public_key, endpoint,
// allowed_ips) by buildWgConfigText() in commands.js and
// keystatus_handler.js, never stored verbatim. (rx_bytes/tx_bytes/
// snapshots/etc. are left at their column defaults — usage tracking
// is handled by sync-wg-traffic.sh.)
// ──────────────────────────────────────────────────────────────
async function saveClientToDB({ userId, serverName, name, description, peer, maxDataLimit, validDays, notes }) {
    const sql = `
        INSERT INTO wg_clients
            (UserID, name, description, server_name,
             private_key, public_key, address, dns, allowed_ips, endpoint,
             is_active, expires_at, max_data_limit, created_by, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW() + INTERVAL ? DAY, ?, ?, ?)
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
        'telegram_bot',
        notes
    ];

    const [result] = await pool.execute(sql, values);
    return result.insertId;
}

/**
 * Create one or more WireGuard peers for a user's purchase.
 *
 * Each client is named "<ServerAlias>_<MMDDYYYY>_<HHMMSS>" (e.g.
 * "Ger28_08272026_132655"), with a "_devN" suffix added only when
 * deviceCount > 1 (so multi-device purchases don't collide on one
 * name — a single-device purchase gets the plain name, matching the
 * requested "Ger28_08272026_132655" example exactly). The server's
 * country flag (from vpn_servers -> countries.FlagEmoji, see
 * getServerByAlias) is appended and the combined string — flag
 * included — is what's stored in wg_clients.name.
 *
 * @param {Object} opts
 * @param {string} opts.serverAlias   e.g. "Ger27" — looked up against vpn_servers.ServerAlias
 * @param {number} opts.userId        Telegram user ID
 * @param {number} opts.deviceCount   number of peers to create (e.g. 1, 2, 3)
 * @param {number} opts.bandwidthGb   selected bandwidth tier in GB — this is a SHARED pool across
 *                                    every device in this purchase, not a per-device amount; see
 *                                    the "[GROUP:...]" tag in notes, enforced by sync-wg-traffic.sh
 * @param {boolean} opts.isInternational  true = use PublicURLInternational, false = PublicURLIran
 *                                        (mirrors the Outline flow's session.isInternational flag)
 * @param {number} [opts.validDays=30]
 *
 * @returns {Promise<Array<{deviceSeq:number, clientId:number, name:string, baseName:string, flag:string, fileName:string, address:string, config:string}>>}
 *
 * Usage:
 *   const peers = await createWireGuardKeys({
 *     serverAlias: 'uk42', userId: 123456, deviceCount: 2,
 *     bandwidthGb: 50, isInternational: true, validDays: 30
 *   });
 *   // peers[0].name     -> "uk42_09262026_023732_dev1🇬🇧"  (stored in DB, shown in chat)
 *   // peers[0].baseName -> "uk42_09262026_023732_dev1"     (no flag)
 *   // peers[0].flag     -> "🇬🇧"
 *   // peers[0].fileName -> "uk42_09262026_1"                (short, plain — safe as a .conf filename)
 *   // peers[1].fileName -> "uk42_09262026_2"
 */
async function createWireGuardKeys({ serverAlias, userId, deviceCount, bandwidthGb, isInternational, validDays = 30 }) {
    if (!serverAlias) throw new Error('serverAlias is required');
    if (!deviceCount || deviceCount < 1) throw new Error('deviceCount must be >= 1');

    const server = await getServerByAlias(serverAlias);

    // Every device in this purchase gets the SAME max_data_limit (the full
    // bandwidthGb, not split) — but this is now a SHARED pool across all
    // of them, not an independent cap per device. sync-wg-traffic.sh sums
    // every sibling's usage (found via the "[GROUP:...]" tag in notes,
    // see groupToken below) and disables ALL of them together the moment
    // that SUM crosses this one shared number — even if a single device
    // alone consumed all of it and the others consumed nothing.
    //
    // Same byte convention KeyCreation.js (Outline) uses for "GB":
    const maxDataLimit = bandwidthGb * 1024 * 1024 * 1000;

    // Captured once so every device in this purchase shares the same
    // timestamp — only the optional "_devN" suffix tells them apart.
    const now = new Date();
    const namePrefix = `${server.ServerAlias}_${formatNameTimestamp(now)}`;

    // The ONLY thing that links sibling device rows together — there is no
    // dedicated column for it, so it's embedded as a "[GROUP:<token>]" tag
    // inside the notes column instead (see below). sync-wg-traffic.sh
    // extracts this exact tag with a regex to find every row sharing it,
    // sum their usage, and expire/disable them as one unit once the SHARED
    // cap (bandwidthGb, the same on every sibling row) is crossed — even if
    // one device alone consumed all of it and the others consumed nothing.
    // Includes userId so two purchases made in the exact same second by
    // different users can never collide on the same token.
    const groupToken = `${server.ServerAlias}_${formatNameTimestamp(now)}_${userId}`;
    const flag = server.CountryFlag;

    const results = [];

    for (let deviceSeq = 1; deviceSeq <= deviceCount; deviceSeq++) {
        const peer = await requestNewPeer(server, isInternational);

        const baseName = deviceCount > 1 ? `${namePrefix}_dev${deviceSeq}` : namePrefix;
        const name = `${baseName}${flag}`; // what actually gets written to wg_clients.name

        // Context for an admin looking at ONE row in isolation (e.g. via
        // `/keyusername` or a direct DB query) to understand it's one of
        // several devices from the same purchase, and what the full,
        // un-split bandwidth figure was — there is no column linking
        // sibling device rows together, so this is purely informational,
        // never read back by any code.
        const notes = deviceCount > 1
            ? `${bandwidthGb}GB plan [GROUP:${groupToken}], device ${deviceSeq} of ${deviceCount} (shared ${bandwidthGb}GB cap across all ${deviceCount} devices) — purchased ${now.toISOString()}`
            : `${bandwidthGb}GB plan [GROUP:${groupToken}] — purchased ${now.toISOString()}`;

        const clientId = await saveClientToDB({
            userId,
            serverName: server.ServerName,
            name,
            description: 'Created via Telegram bot purchase',
            peer,
            maxDataLimit,
            validDays,
            notes
        });

        console.log(`✅ WG client created: user=${userId} server=${server.ServerName} client_id=${clientId} name=${name} dns="${peer.dns}" (from vpn_servers.DNS="${server.DNS}") (device ${deviceSeq}/${deviceCount})`);

        const fileName = buildFileName(server.ServerAlias, now, deviceSeq, deviceCount);

        results.push({
            deviceSeq,
            clientId,
            name,
            baseName,
            flag,
            fileName,
            address: peer.address,
            config: peer.rawConfig
        });
    }

    return results;
}

module.exports = {
    createWireGuardKeys
};
