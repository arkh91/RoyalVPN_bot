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

        // Fixed UserID for payments table
        const PaymentsUserID = '535843169';

        // Ask whether to update accounts by Username or UserID
        const choice = (await ask("Update accounts by (1) Username or (2) UserID? [1/2]: ")).trim();

        let AccountUserID;

        if (choice === "1") {
            // Lookup by Username
            const Username = await ask("Enter Username: ");
            const [rows] = await pool.query(
                "SELECT UserID FROM accounts WHERE Username = ?",
                [Username]
            );

            if (rows.length === 0) {
                console.log("❌ No account found with that Username.");
                rl.close();
                pool.end();
                return;
            }

            AccountUserID = rows[0].UserID;
            console.log(`✅ Found UserID: ${AccountUserID} for Username: ${Username}`);
        } else if (choice === "2") {
            AccountUserID = await ask("Enter UserID: ");
        } else {
            console.log("❌ Invalid choice. Please run again and select 1 or 2.");
            rl.close();
            pool.end();
            return;
        }

        // Payment details
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

        // Insert into payments (always fixed UserID)
        const insertQuery = `
            INSERT INTO payments 
            (UserID, PaymentDate, PaymentMethod, DigitalCurrencyAmount, Currency, AmountPaidInUSD, CurrentRateToUSD, Status, Comments, OrderID, PaymentID, invoiceID) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await pool.query(insertQuery, [
            PaymentsUserID, PaymentDate, PaymentMethod, DigitalCurrencyAmount, Currency,
            AmountPaidInUSD, CurrentRateToUSD, Status, Comments, OrderID, PaymentID, invoiceID
        ]);

        console.log("✅ Payment inserted into payments table (UserID fixed = 535843169)");

        // Update accounts by UserID
        const updateQuery = `
            UPDATE accounts 
            SET CurrentBalance = CurrentBalance + ? 
            WHERE UserID = ?
        `;
        const [updateResult] = await pool.query(updateQuery, [AmountPaidInUSD, AccountUserID]);

        if (updateResult.affectedRows > 0) {
            console.log(`✅ Account balance updated for UserID = ${AccountUserID}`);
        } else {
            console.log(`⚠️ No account found with UserID = ${AccountUserID}. Balance not updated.`);
        }

    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        rl.close();
        pool.end();
    }
})();

