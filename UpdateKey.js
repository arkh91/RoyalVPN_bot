// UpdateKey.js
const readline = require("readline");
const db = require("./db"); // uses your db.js config

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

// Extract GuiKey from FullKey (everything from "#" onward)
function extractGuiKey(fullKey) {
  const hashIndex = fullKey.indexOf("#");
  return hashIndex !== -1 ? fullKey.substring(hashIndex) : fullKey;
}

async function main() {
  try {
    const oldKey = await askQuestion("Enter Old Key: ");
    const newKey = await askQuestion("Enter New Key: ");

    // Prepare GuiKey from newKey
    const newGuiKey = extractGuiKey(newKey);

    // Check if old key exists
    const [rows] = await db.execute(
      "SELECT UserID, ServerName, FullKey, GuiKey FROM UserKeys WHERE FullKey = ? OR GuiKey = ? LIMIT 1",
      [oldKey, oldKey]
    );

    if (rows.length === 0) {
      console.log("❌ Old key not found in database.");
      return;
    }

    //console.log("ℹ️ Found row:", rows[0]);

    // Update both FullKey and GuiKey
    const [result] = await db.execute(
      "UPDATE UserKeys SET FullKey = ?, GuiKey = ? WHERE FullKey = ? OR GuiKey = ?",
      [newKey, newGuiKey, oldKey, oldKey]
    );

    if (result.affectedRows > 0) {
      console.log("✅ FullKey and GuiKey updated successfully!");
      console.log("👉 New GuiKey:", newGuiKey);
    } else {
      console.log("❌ No rows were updated. Double-check the old key.");
    }
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    if (db && db.end) await db.end();
  }
}

main();
