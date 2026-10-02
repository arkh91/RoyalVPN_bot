// payment/index.js
//
// Usage (main.js / commands.js):
//   const { sendPaymentMenu, handlePaymentCallback, startPaymentPoller } = require('./payment');
//
// One entry point so the rest of the bot never reaches into payment/ internals.
const { paymentMenu, sendPaymentMenu, handlePaymentCallback } = require('./menus');
const { startPaymentPoller, pollOnce } = require('./poller');

module.exports = {
    paymentMenu,
    sendPaymentMenu,
    handlePaymentCallback,
    startPaymentPoller,
    pollOnce
};
