// payment/menus.js
//
// Everything the user sees for /payment: the method menu, the coin / network /
// amount menus and the final "send X to address Y" message.
//
// Callback data used (all < 64 bytes, Telegram's limit):
//   pay_direct                       Direct (Credit Card)  -> "under development"
//   pay_nowpayment                   Crypto menu (coin list)
//   back_to_payment                  back to the first menu
//   np:c:<coin>                      coin chosen      -> network list
//   np:n:<coin>:<network>            network chosen   -> amount list
//   np:a:<coin>:<network>:<usd>      amount chosen    -> payment is created
// Anything else is ignored (handlePaymentCallback returns false).

const { COINS, AMOUNTS_USD, PAYMENT_METHOD, OPEN_STATUSES, MAX_OPEN_PAYMENTS_PER_USER } = require('./config');
const { createNowPaymentsPayment, describeNowPaymentsError } = require('./createNowPaymentsPayment');
const { escapeHtml, alertAdmin } = require('./settlePayment');

// Users with a payment being created right now (stops double-tap duplicates).
const creating = new Set();

/**
 * Usage:
 *   const { text, reply_markup } = paymentMenu();
 *   await bot.sendMessage(chatId, text, { reply_markup });
 */
function paymentMenu() {
    return {
        text: '💳 Please choose a payment method:',
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Direct (Credit Card)', callback_data: 'pay_direct' }],
                [{ text: 'Crypto Currency', callback_data: 'pay_nowpayment' }],
                [{ text: '⬅️ Go Back', callback_data: 'back_to_main' }]
            ]
        }
    };
}

/**
 * Usage:
 *   sendPaymentMenu(bot, msg.chat.id);   // inside bot.onText(/\/payment/, ...)
 */
function sendPaymentMenu(bot, chatId) {
    const { text, reply_markup } = paymentMenu();
    return bot.sendMessage(chatId, text, { reply_markup });
}

/**
 * Usage:
 *   await editOrIgnore(bot, query, 'text', { inline_keyboard: [...] }, 'HTML');
 *
 * editMessageText that ignores Telegram's harmless "message is not modified".
 */
async function editOrIgnore(bot, query, text, replyMarkup, parseMode) {
    try {
        await bot.editMessageText(text, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            reply_markup: replyMarkup,
            ...(parseMode ? { parse_mode: parseMode } : {})
        });
    } catch (err) {
        const desc = err?.response?.body?.description || err.message || '';
        if (!/message is not modified/i.test(desc)) console.error('❌ editMessageText failed:', desc);
    }
}

/**
 * Usage:
 *   const net = findNetwork('usdt', 'ton');   // -> { label, ticker, fee, speed } or null
 *
 * Looks the coin/network up in config.js. Callback data is user-controlled,
 * so nothing is trusted until it matches the config.
 */
function findNetwork(coinKey, netKey) {
    const coin = COINS[coinKey];
    if (!coin || !Object.prototype.hasOwnProperty.call(coin.networks, netKey)) return null;
    return coin.networks[netKey];
}

/**
 * Usage:
 *   const kb = coinKeyboard();   // buttons for every coin in config.js
 */
function coinKeyboard() {
    const rows = Object.entries(COINS).map(([key, coin]) => [{ text: coin.label, callback_data: `np:c:${key}` }]);
    rows.push([{ text: '⬅️ Go Back', callback_data: 'back_to_payment' }]);
    return { inline_keyboard: rows };
}

/**
 * Usage:
 *   const { text, kb } = networkMenu('usdt');
 *
 * Network list for one coin: just the heading and one button per network.
 */
function networkMenu(coinKey) {
    const coin = COINS[coinKey];
    const rows = Object.entries(coin.networks).map(([netKey, net]) => [
        { text: net.label, callback_data: `np:n:${coinKey}:${netKey}` }
    ]);
    rows.push([{ text: '⬅️ Go Back', callback_data: 'pay_nowpayment' }]);

    return { text: `🔗 Choose the ${coin.label} network:`, kb: { inline_keyboard: rows } };
}

/**
 * Usage:
 *   const kb = amountKeyboard('usdt', 'ton');   // $3 $5 / $10 $20 / $50 $100 + Go Back
 */
function amountKeyboard(coinKey, netKey) {
    const buttons = AMOUNTS_USD.map((usd) => ({ text: `$${usd}`, callback_data: `np:a:${coinKey}:${netKey}:${usd}` }));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    rows.push([{ text: '⬅️ Go Back', callback_data: `np:c:${coinKey}` }]);
    return { inline_keyboard: rows };
}

/**
 * Usage:
 *   formatCryptoAmount(0.00001234)   // -> '0.00001234'  (never '1.234e-5')
 *   formatCryptoAmount('12.5')       // -> '12.5'
 */
function formatCryptoAmount(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    return num.toFixed(8).replace(/\.?0+$/, '');
}

/**
 * Usage:
 *   const html = paymentInstructions(payment, COINS.usdt, net, usd);
 *
 * The message shown after the payment was created. Address and amount are in
 * <code> tags so one tap copies them.
 */
function paymentInstructions(payment, coin, net, usd) {
    const lines = [
        '✅ <b>Payment created</b>',
        '',
        `Send <b>exactly</b> this amount on <b>${escapeHtml(net.label.replace(/^[^\w]+/u, ''))}</b>:`,
        `<code>${escapeHtml(formatCryptoAmount(payment.pay_amount))}</code> ${escapeHtml(coin.symbol)}`,
        '',
        'To this address:',
        `<code>${escapeHtml(payment.pay_address)}</code>`
    ];
    if (payment.payin_extra_id) {
        lines.push('', '📝 <b>Memo / tag (REQUIRED):</b>', `<code>${escapeHtml(payment.payin_extra_id)}</code>`);
    }
    lines.push(
        '',
        `💵 You will receive: <b>$${usd.toFixed(2)}</b> of balance`,
        payment.valid_until ? `⏱ Valid until: ${escapeHtml(payment.valid_until)}` : '',
        '',
        '⚠️ Send only the coin and network shown above - anything else is lost.',
        '',
        '🔔 You do not need to do anything else. I will message you automatically when the payment is detected and again when your balance is credited.',
        `🧾 Order: <code>${escapeHtml(payment.order_id)}</code>`
    );
    return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
}

/**
 * Usage:
 *   await startPayment(bot, db, query, 'usdt', 'ton', 10);
 *
 * Creates the DB row, asks NowPayments for a payment, stores the payment_id
 * and shows the instructions. The row is written FIRST (status 'creating') so
 * a crash can never leave a real payment that the bot does not know about.
 */
async function startPayment(bot, db, query, coinKey, netKey, usd) {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const net = findNetwork(coinKey, netKey);

    if (creating.has(userId)) return;
    creating.add(userId);

    const orderId = `order_${userId}_${Date.now()}`;
    let rowInserted = false;

    try {
        const placeholders = OPEN_STATUSES.map(() => '?').join(', ');
        const [open] = await db.query(
            `SELECT COUNT(*) AS n FROM payments WHERE UserID = ? AND PaymentMethod = ? AND Status IN ('creating', ${placeholders})`,
            [userId, PAYMENT_METHOD, ...OPEN_STATUSES]
        );
        if (Number(open[0].n) >= MAX_OPEN_PAYMENTS_PER_USER) {
            await editOrIgnore(bot, query,
                '⚠️ You already have several unpaid crypto payments open. Please pay one of them (the bot will notify you) or wait for them to expire.',
                { inline_keyboard: [[{ text: '⬅️ Go Back', callback_data: 'back_to_payment' }]] });
            return;
        }

        await editOrIgnore(bot, query, `🪙 Generating your ${COINS[coinKey].label} payment for $${usd}...`);

        await db.query(
            `INSERT INTO payments
               (UserID, PaymentDate, PaymentMethod, DigitalCurrencyAmount, Currency, AmountPaidInUSD,
                CurrentRateToUSD, Status, Comments, OrderID, PaymentID, invoiceID)
             VALUES (?, CURDATE(), ?, NULL, ?, ?, NULL, 'creating', ?, ?, NULL, NULL)`,
            [userId, PAYMENT_METHOD, net.ticker.toUpperCase(), usd.toFixed(2), `${COINS[coinKey].label} - ${net.label}`, orderId]
        );
        rowInserted = true;

        const payment = await createNowPaymentsPayment(orderId, usd, net.ticker);

        try {
            await db.query(
                "UPDATE payments SET PaymentID = ?, Status = 'waiting', Comments = ? WHERE OrderID = ?",
                [payment.payment_id, `${COINS[coinKey].label} - ${net.label} - waiting for payment`, orderId]
            );
        } catch (dbErr) {
            // The payment exists at NowPayments but we could not save its id: a human must fix this row.
            console.error('❌ Could not store PaymentID:', dbErr.message, payment);
            await alertAdmin(bot, `Order ${orderId}: payment ${payment.payment_id} created but PaymentID was not saved (${dbErr.message}). Set payments.PaymentID and Status='waiting' by hand.`);
        }

        await bot.sendMessage(chatId, paymentInstructions(payment, COINS[coinKey], net, usd), { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
        const reason = describeNowPaymentsError(err);
        console.error(`❌ Could not create ${net.ticker} payment for ${userId}:`, reason);

        if (rowInserted) {
            await db.query("UPDATE payments SET Status = 'failed', Comments = ? WHERE OrderID = ?", [`Create failed: ${reason}`.slice(0, 250), orderId])
                .catch((e) => console.error('❌ Could not mark row failed:', e.message));
        }

        const tooSmall = /minimal|too small|less than/i.test(reason);
        await bot.sendMessage(
            chatId,
            tooSmall
                ? '❌ That amount is below the minimum for this coin. Please choose a larger amount.'
                : '❌ Could not create the payment right now. Please try again in a few minutes or pick another coin.'
        );
    } finally {
        creating.delete(userId);
    }
}

/**
 * Usage (first lines of bot.on('callback_query') in main.js):
 *   if (await handlePaymentCallback(bot, query, { db })) return;
 *
 * Returns true when the callback belonged to the payment flow (and was handled),
 * false when main.js should keep processing it.
 */
async function handlePaymentCallback(bot, query, { db }) {
    const data = query.data || '';
    const isPaymentCallback =
        data === 'pay_direct' || data === 'pay_nowpayment' || data === 'back_to_payment' || data.startsWith('np:');
    if (!isPaymentCallback) return false;

    // Stop the spinner on the user's button.
    bot.answerCallbackQuery(query.id).catch(() => {});

    if (data === 'back_to_payment') {
        const { text, reply_markup } = paymentMenu();
        await editOrIgnore(bot, query, text, reply_markup);
        return true;
    }

    if (data === 'pay_direct') {
        await editOrIgnore(bot, query,
            '🚧 Direct (Credit Card) payment is under development.\n\nPlease use Crypto Currency for now.',
            { inline_keyboard: [[{ text: '⬅️ Go Back', callback_data: 'back_to_payment' }]] });
        return true;
    }

    if (data === 'pay_nowpayment') {
        await editOrIgnore(bot, query, '🪙 Choose a cryptocurrency:', coinKeyboard());
        return true;
    }

    const parts = data.split(':'); // ['np', kind, coin, network?, amount?]
    const [, kind, coinKey, netKey, amountText] = parts;

    if (kind === 'c' && COINS[coinKey]) {
        const { text, kb } = networkMenu(coinKey);
        await editOrIgnore(bot, query, text, kb);
        return true;
    }

    if (kind === 'n' && findNetwork(coinKey, netKey)) {
        await editOrIgnore(bot, query, '💰 Choose the amount to pay in USD:', amountKeyboard(coinKey, netKey));
        return true;
    }

    if (kind === 'a' && findNetwork(coinKey, netKey)) {
        const usd = Number(amountText);
        if (!AMOUNTS_USD.includes(usd)) return true; // forged amount: ignore
        await startPayment(bot, db, query, coinKey, netKey, usd);
        return true;
    }

    // Stale button (e.g. a coin that was removed from config.js).
    await editOrIgnore(bot, query, '⚠️ This option is no longer available.', paymentMenu().reply_markup);
    return true;
}

module.exports = { paymentMenu, sendPaymentMenu, handlePaymentCallback };
