Old invoice-based payment code, kept for reference only. Nothing requires these
files any more. Delete this folder once the new flow has been running for a while.

 createNowPaymentsSession.js   invoice link flow (replaced by ../createNowPaymentsPayment.js)
 getNowPaymentsInvoiceStatus.js, getNowPaymentsStatus*.js, updatePendingPayments.js
                               manual status checks (replaced by ../poller.js + ../settlePayment.js)
 webhook.js                    never mounted; its signature check always passed (replaced by ../ipn.js)
