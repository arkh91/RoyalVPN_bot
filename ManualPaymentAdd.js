// ManualPaymentAdd.js
const pool = require('./db');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
}

(async () => {
    try {
        console.log("=== Manual Payment Entry ===");

        const UserID = '535843169'; // fixed UserID
        const Username = await ask("Username (for account update): ");

        let PaymentDate = await ask("Payment Date (leave blank for NOW): ");
        if (!PaymentDate) {
            PaymentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
        }

        const PaymentMethod = await ask("Payment Method: ");
        const DigitalCurrencyAmountInput = await ask("Digital Currency Amount: ");
        const DigitalCurrencyAmount = DigitalCurrencyAmountInput ? parseFloat(DigitalCurrencyAmountInput) : null;

        const Currency = await ask("Currency (e.g. USDT, BTC, USD): ");

        const AmountPaidInUSDInput = await ask("Amount Paid in USD: ");
        const AmountPaidInUSD = AmountPaidInUSDInput ? parseFloat(AmountPaidInUSDInput) : 0;

        const CurrentRateToUSDInput = await ask("Current Rate to USD: ");
        const CurrentRateToUSD = CurrentRateToUSDInput ? parseFloat(CurrentRateToUSDInput) : null;

        const Status = await ask("Status (confirmed, pending, failed): ");
        const Comments = await ask("Comments: ");
        const OrderID = await ask("Order ID: ");
        const PaymentID = await ask("Payment ID: ");
        const invoiceID = await ask("Invoice ID: ");

        const insertQuery = `
            INSERT INTO payments 
            (UserID, PaymentDate, PaymentMethod, DigitalCurrencyAmount, Currency, AmountPaidInUSD, CurrentRateToUSD, Status, Comments, OrderID, PaymentID, invoiceID) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await pool.query(insertQuery, [
            UserID, PaymentDate, PaymentMethod, DigitalCurrencyAmount, Currency,
            AmountPaidInUSD, CurrentRateToUSD, Status, Comments, OrderID, PaymentID, invoiceID
        ]);

        const updateQuery = `
            UPDATE accounts 
            SET CurrentBalance = CurrentBalance + ? 
            WHERE Username = ?
        `;
        await pool.query(updateQuery, [AmountPaidInUSD, Username]);

        console.log("✅ Payment recorded & account balance updated successfully!");
    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        rl.close();
        pool.end();
    }
})();
