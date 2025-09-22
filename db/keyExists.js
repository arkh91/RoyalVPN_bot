/*
const SERVERS = require('../servers');
const https = require('https');

async function KeyExists(serverName, guiKey) {
    try {
        console.log(`Checking if key exists on server ${serverName}`);
        console.log(`Original GUI key: ${guiKey}`);
        
        if (!SERVERS[serverName]) {
            console.error(`❌Server ${serverName} not found in configuration`);
            return false;
        }

        const server = SERVERS[serverName];
        const url = `${server.apiUrl}${server.apiKey}/access-keys`;
        
        console.log(`Making request to: ${url.replace(server.apiKey, 'REDACTED')}`);

        return new Promise((resolve, reject) => {
            const req = https.get(url, { 
                rejectUnauthorized: false,
                timeout: 10000
            }, (res) => {
                console.log(`Response status: ${res.statusCode}`);
                
                if (res.statusCode !== 200) {
                    console.error(`Server returned status code: ${res.statusCode}`);
                    resolve(false);
                    return;
                }

                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        
                        let keysArray = [];
                        
                        if (response.accessKeys && Array.isArray(response.accessKeys)) {
                            keysArray = response.accessKeys;
                        } else if (Array.isArray(response)) {
                            keysArray = response;
                        }
                        
                        console.log(`Found ${keysArray.length} keys on server`);
                        
                        // Remove the '#' prefix from the GUI key for matching
                        const keyToFind = guiKey.startsWith('#') ? guiKey.substring(1) : guiKey;
                        console.log(`Looking for key: "${keyToFind}"`);
                        
                        const keyExists = keysArray.some(key => {
                            // Check the 'name' field (which is what contains the key identifier)
                            return key.name === keyToFind;
                        });
                        
                        if (keyExists) {
                            console.log(`✅ Key FOUND on server ${serverName}`);
                        } else {
                            console.log(`❌ Key NOT found on server ${serverName}`);
                        }
                        
                        resolve(keyExists);
                    } catch (parseError) {
                        console.error(`Error parsing response:`, parseError);
                        resolve(false);
                    }
                });
            });

            req.on('error', (error) => {
                console.error(`Error fetching keys:`, error);
                resolve(false);
            });

            req.on('timeout', () => {
                console.error(`Timeout fetching keys`);
                req.destroy();
                resolve(false);
            });
        });
    } catch (error) {
        console.error(`Unexpected error:`, error);
        return false;
    }
}

module.exports = KeyExists;
*/
const SERVERS = require('../servers');
const https = require('https');

async function KeyExists(serverName, guiKey) {
    try {
        if (!SERVERS[serverName]) {
            return false;
        }

        const server = SERVERS[serverName];
        const url = `${server.apiUrl}${server.apiKey}/access-keys`;

        return new Promise((resolve, reject) => {
            const req = https.get(url, { 
                rejectUnauthorized: false,
                timeout: 10000
            }, (res) => {
                if (res.statusCode !== 200) {
                    resolve(false);
                    return;
                }

                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        
                        let keysArray = [];
                        
                        if (response.accessKeys && Array.isArray(response.accessKeys)) {
                            keysArray = response.accessKeys;
                        } else if (Array.isArray(response)) {
                            keysArray = response;
                        }
                        
                        // Remove the '#' prefix from the GUI key for matching
                        const keyToFind = guiKey.startsWith('#') ? guiKey.substring(1) : guiKey;
                        
                        const keyExists = keysArray.some(key => key.name === keyToFind);
                        resolve(keyExists);
                    } catch (parseError) {
                        resolve(false);
                    }
                });
            });

            req.on('error', (error) => {
                resolve(false);
            });

            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    } catch (error) {
        return false;
    }
}

module.exports = KeyExists;
