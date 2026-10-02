// payment/settlePayment.js
//
// The ONE place where a NowPayments status turns into database changes and
// user notifications. Used by the poller (and by ipn.js if you enable it).
//
// Safety rules:
//   * The balance is credited exactly once: the payments row is locked
//     (SELECT ... FOR UPDATE) and the credit happens in the same transaction
//     that flips Status to 'finished'. A second call finds 'finished' and stops.
//   * The credited amount is the USD amount stored when the payment was created,
//     never a number coming from the network.
//   * The user ID comes from our own payments row, never from the API.
//   * Partial payments are NOT auto-credited - the admin is alerted instead.

const {
    CREDIT_STATUS,
    DEAD_STATUSES,
    ADMIN_CHAT_ID
} = require('./config');

/**
 * Usage:
 *   escapeHtml('a < b')   // -> 'a &lt; b'
 */
function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Usage:
 *   await safeSend(bot, chatId, '<b>hi</b>');
 *
 * Sends an HTML message and swallows errors (e.g. user blocked the bot).
 * A failed notification must never undo a balance change.
 */
async function safeSend(bot, chatId, html) {
    try {
        await bot.sendMessage(chatId, html, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
        console.error(`⚠️ Could not message ${chatId}:`, err?.response?.body?.description || err.message);
    }
}

/**
 * Usage:
 *   await alertAdmin(bot, 'Payment 123 needs review');
 */
async function alertAdmin(bot, text) {
    await safeSend(bot, ADMIN_CHAT_ID, `🚨 <b>Payment alert</b>\n${escapeHtml(text)}`);
}

/**
 * Usage:
 *   rateToUsd(10, 9.98)   // -> '1.00200401'   (USD per 1 coin, 8 decimals)
 *   rateToUsd(10, 0)      // -> null
 */
function rateToUsd(priceUsd, actuallyPaid) {
    const paid = Number(actuallyPaid);
    const price = Number(priceUsd);
    if (!(paid > 0) || !(price > 0)) return null;
    return (price / paid).toFixed(8);
}

/**
 * Usage:
 *   const ok = await creditFinishedPayment(db, bot, row, apiData);
 *   // true  -> balance credited now and the user was told
 *   // false -> nothing credited (already finished, mismatch, no account...)
 *
 * Locks the payments row, checks it, flips it to 'finished' and adds the USD
 * amount to accounts.CurrentBalance - all in one transaction.
 */
async function creditFinishedPayment(db, bot, row, apiData) {
    const conn = await db.getConnection();
    let credited = null;

    try {
        await conn.beginTransaction();

        const [locked] = await conn.query(
            'SELECT UserID, Status, AmountPaidInUSD FROM payments WHERE OrderID = ? FOR UPDATE',
            [row.OrderID]
        );
        const current = locked[0];

        // Already settled (poller + IPN raced, or a duplicate call) -> do nothing.
        if (!current || current.Status === CREDIT_STATUS) {
            await conn.rollback();
            return false;
        }

        const usd = Number(current.AmountPaidInUSD);
        const apiPrice = Number(apiData.price_amount);

        // Safety net: what NowPayments says was priced must equal what we stored.
        if (!(usd > 0) || Math.abs(apiPrice - usd) > 0.01) {
            await conn.query(
                "UPDATE payments SET Status = 'review', Comments = ? WHERE OrderID = ?",
                [`Amount mismatch: stored ${usd} USD, NowPayments price_amount ${apiPrice}`, row.OrderID]
            );
            await conn.commit();
            await alertAdmin(bot, `Order ${row.OrderID}: stored ${usd} USD but NowPayments reports ${apiPrice}. Not credited.`);
            return false;
        }

        await conn.query(
            `UPDATE payments
                SET Status = ?, DigitalCurrencyAmount = ?, CurrentRateToUSD = ?, Comments = ?
              WHERE OrderID = ?`,
            [
                CREDIT_STATUS,
                Number(apiData.actually_paid) > 0 ? apiData.actually_paid : null,
                rateToUsd(usd, apiData.actually_paid),
                `Credited automatically (NowPayments payment ${row.PaymentID})`,
                row.OrderID
            ]
        );

        const [upd] = await conn.query(
            'UPDATE accounts SET CurrentBalance = COALESCE(CurrentBalance, 0) + ? WHERE UserID = ?',
            [usd, current.UserID]
        );

        // No account row -> undo everything so the payment stays visible as unpaid.
        if (upd.affectedRows !== 1) {
            await conn.rollback();
            await alertAdmin(bot, `Order ${row.OrderID}: payment finished but account ${current.UserID} was not found. Not credited.`);
            return false;
        }

        const [bal] = await conn.query('SELECT CurrentBalance FROM accounts WHERE UserID = ?', [current.UserID]);
        await conn.commit();
        credited = { userId: current.UserID, usd, balance: Number(bal[0].CurrentBalance) };
    } catch (err) {
        try { await conn.rollback(); } catch (_) { /* connection already gone */ }
        console.error(`❌ Failed to credit order ${row.OrderID}:`, err.message);
        return false;
    } finally {
        conn.release();
    }

    // Notify AFTER the commit so a Telegram error cannot affect the money.
    await safeSend(
        bot,
        credited.userId,
        `✅ <b>Payment received!</b>\n\n` +
        `💰 Added: <b>$${credited.usd.toFixed(2)}</b>\n` +
        `🏦 New balance: <b>$${credited.balance.toFixed(2)}</b>\n\n` +
        `Thank you! You can now buy your VPN key from the main menu.`
    );
    return true;
}

/**
 * Usage:
 *   await applyPaymentStatus(db, bot, row, apiData);
 *   // row     = a row from the payments table (needs OrderID, PaymentID, UserID, Status)
 *   // apiData = response of GET /payment/{id}
 *
 * Compares the NowPayments status with the stored one and reacts only when it
 * CHANGED - so every notification is sent once. 'finished' -> credit balance.
 */
async function applyPaymentStatus(db, bot, row, apiData) {
    const newStatus = String(apiData.payment_status || '').toLowerCase();
    if (!newStatus || newStatus === row.Status) return;

    // not_found is a lookup problem, not a payment state: leave the row as is.
    if (newStatus === 'not_found') return;

    if (newStatus === CREDIT_STATUS) {
        await creditFinishedPayment(db, bot, row, apiData);
        return;
    }

    // Never move a finished row backwards.
    const [res] = await db.query(
        "UPDATE payments SET Status = ?, Comments = ? WHERE OrderID = ? AND Status <> 'finished'",
        [newStatus, `NowPayments status: ${newStatus}`, row.OrderID]
    );
    if (res.affectedRows !== 1) return;

    if (newStatus === 'confirming') {
        await safeSend(bot, row.UserID,
            '⏳ <b>Payment detected!</b>\nWaiting for blockchain confirmations - your balance will be added automatically.');
    } else if (newStatus === 'partially_paid') {
        await safeSend(bot, row.UserID,
            '⚠️ <b>Partial payment received.</b>\nThe amount sent was lower than requested, so your balance was NOT credited yet. ' +
            'Please contact support and mention your order number:\n<code>' + escapeHtml(row.OrderID) + '</code>');
        await alertAdmin(bot, `Order ${row.OrderID} (user ${row.UserID}) is partially_paid: actually_paid ${apiData.actually_paid} of ${apiData.pay_amount} ${apiData.pay_currency}.`);
    } else if (DEAD_STATUSES.includes(newStatus)) {
        const reason = newStatus === 'expired'
            ? 'The payment window expired before funds arrived.'
            : `Status: ${newStatus}.`;
        await safeSend(bot, row.UserID,
            `❌ <b>Payment ${escapeHtml(newStatus)}</b>\n${reason}\n` +
            'If you already sent funds, contact support with your order number:\n<code>' + escapeHtml(row.OrderID) + '</code>');
    }
    // 'confirmed' and 'sending' are internal steps - no message needed.
}

module.exports = { applyPaymentStatus, creditFinishedPayment, escapeHtml, safeSend, alertAdmin };
