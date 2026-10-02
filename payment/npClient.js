// payment/npClient.js
//
// Usage:
//   const npClient = require('./npClient');
//   const { data } = await npClient.get('/payment/123456789');
//   const { data } = await npClient.post('/payment', payload);
//
// Shared axios instance for the NowPayments API. The API key comes from
// token.js (NOWPAYMENTS_API_KEY). The timeout stops a hung request from
// freezing the poller.
const axios = require('axios');
const { NOWPAYMENTS_API_KEY } = require('../token');

const npClient = axios.create({
    baseURL: 'https://api.nowpayments.io/v1',
    timeout: 15000,
    headers: {
        'x-api-key': NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json'
    }
});

module.exports = npClient;
