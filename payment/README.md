# payment/

Crypto top-ups through NowPayments, with automatic payment detection.

| File | Job |
|---|---|
| `config.js` | Coins, networks, NowPayments tickers, amounts, poll interval. **Edit this to change the menus.** |
| `menus.js` | `/payment` menus + callbacks (`pay_direct`, `pay_nowpayment`, `np:...`) and the "send X to address Y" message |
| `createNowPaymentsPayment.js` | `POST /payment` - returns payment_id, address, exact amount |
| `getNowPaymentsStatus.js` | `GET /payment/{id}` |
| `settlePayment.js` | Status -> DB + user message. Credits the balance exactly once (row lock + transaction) |
| `poller.js` | Background loop (every 30 s) over open payments |
| `ipn.js` | OPTIONAL instant webhook (not mounted by default) |
| `checkTickers.js` | `node payment/checkTickers.js` - verifies every ticker is enabled on your NowPayments account |
| `legacy/` | Old invoice code, unused. Delete when happy. |

## Edit with vi

    vi payment/config.js      # coins, networks, amounts, interval
    vi payment/menus.js       # wording of the menus / messages

## Payment life cycle (payments.Status)

    creating -> waiting -> confirming -> (confirmed -> sending ->) finished   (balance credited, user notified)
                       \-> partially_paid   (NOT credited; user + admin alerted)
                       \-> failed / expired / refunded   (user notified)
    review = stored USD amount differs from NowPayments' price_amount (NOT credited; admin alerted)

Rows made by this flow have `PaymentMethod = 'NowPayments'`. The poller only
touches those rows, so old invoice rows are never modified.

## Optional index (faster poller query once the table grows)

    CREATE INDEX idx_payments_method_status ON payments (PaymentMethod, Status);

## Re-enabling Toncoin / Gram

Uncomment the `ton` block in `config.js`, set the ticker NowPayments lists for it,
then run `node payment/checkTickers.js`.
