const crypto = require('crypto');
const fs = require('fs');
const { IPN } = require('../token');

const payload = fs.readFileSync('payload.json').toString(); // ✅ exact bytes
const hmac = crypto.createHmac('sha512', IPN);
hmac.update(payload);
const signature = hmac.digest('hex');

console.log(signature);
