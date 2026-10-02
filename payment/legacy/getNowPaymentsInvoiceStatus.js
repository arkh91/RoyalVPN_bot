const npClient = require("./npClient");

async function getNowPaymentsInvoiceStatus(invoiceId) {
  try {
    const { data } = await npClient.get(`/invoice/${invoiceId}`);
    console.log("✅ Invoice status:", data);
    return data; // data.status will be 'waiting', 'finished', etc.
  } catch (error) {
    console.error("❌ Error fetching NowPayments invoice status:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    return null;
  }
}

module.exports = getNowPaymentsInvoiceStatus;

