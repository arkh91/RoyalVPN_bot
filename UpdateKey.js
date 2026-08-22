// replaceKey.js
//
// Usage:
//   node replaceKey.js
//   (interactive: prompts for Old Key, then New Key)
//
// Replaces a UserKeys row's FullKey/GuiKey with a new key, and derives
// the correct ServerName from the new key's connection host — so a
// server migration (like the Ger27->Ger28 issue) can't silently leave
// ServerName pointing at the wrong server the way a manual FullKey-only
// edit did earlier.
const readline = require("readline");
const db = require("./db"); // uses your db.js config
const SERVERS = require("./servers");

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

// Usage:
//   extractGuiKey('ss://...@host:port#MyTag') -> '#MyTag'
//
// Extract GuiKey from FullKey (everything from "#" onward)
function extractGuiKey(fullKey) {
  const hashIndex = fullKey.indexOf("#");
  return hashIndex !== -1 ? fullKey.substring(hashIndex) : fullKey;
}

// Usage:
//   extractHost('ss://creds@ger.gerh28.mithracorp.com:22628#Tag') -> 'ger.gerh28.mithracorp.com'
//
// Pulls the connection hostname out of an ss:// URI (the part between
// "@" and the port ":"), so it can be matched against each server's
// `aliases` list in servers.js to figure out which server this key
// actually lives on.
function extractHost(fullKey) {
  const match = fullKey.match(/@([^:]+):/);
  return match ? match[1] : null;
}

// Usage:
//   resolveServerName('ger.gerh28.mithracorp.com', SERVERS) -> 'Ger28' or null
//
// Looks through every server in SERVERS and returns the server name
// whose `aliases` array contains this host. Falls back to checking
// whether the host appears inside that server's `apiUrl` too, in case
// aliases wasn't populated for some entries. Returns null if nothing
// matches, so the caller can fall back to asking the operator.
function resolveServerName(host, SERVERS) {
  if (!host) return null;
  for (const [name, config] of Object.entries(SERVERS)) {
    if (Array.isArray(config.aliases) && config.aliases.includes(host)) {
      return name;
    }
  }
  for (const [name, config] of Object.entries(SERVERS)) {
    if (config.apiUrl && config.apiUrl.includes(host)) {
      return name;
    }
  }
  return null;
}

async function main() {
  try {
    // --- 1) Keep asking for Old Key until a real match is found ---
    let oldKeyRow = null;
    let oldKey;

    while (!oldKeyRow) {
      oldKey = await askQuestion("Enter Old Key (or 'exit' to quit): ");

      if (oldKey.toLowerCase() === "exit") {
        console.log("Cancelled.");
        return;
      }

      const [rows] = await db.execute(
        "SELECT UserID, ServerName, FullKey, GuiKey FROM UserKeys WHERE FullKey = ? OR GuiKey = ? LIMIT 1",
        [oldKey, oldKey]
      );

      if (rows.length === 0) {
        console.log("❌ Old key not found in database. Please try again.");
        continue;
      }

      oldKeyRow = rows[0];
    }

    console.log(`ℹ️ Found key for UserID ${oldKeyRow.UserID} on ServerName "${oldKeyRow.ServerName}".`);

    // --- 2) Get the new key ---
    const newKey = await askQuestion("Enter New Key: ");
    const newGuiKey = extractGuiKey(newKey);

    // --- 3) Derive ServerName from the new key's actual host, instead of
    // leaving the old (possibly stale) ServerName in place ---
    const host = extractHost(newKey);
    let newServerName = resolveServerName(host, SERVERS);

    if (!newServerName) {
      console.log(`⚠️ Could not automatically determine ServerName from host "${host || '(none found)'}".`);
      const manual = await askQuestion(
        `Enter ServerName manually (leave blank to keep "${oldKeyRow.ServerName}"): `
      );
      newServerName = manual || oldKeyRow.ServerName;
    } else if (newServerName !== oldKeyRow.ServerName) {
      console.log(`ℹ️ Detected server change: "${oldKeyRow.ServerName}" -> "${newServerName}"`);
    }

    // --- 4) Update FullKey, GuiKey, AND ServerName together ---
    const [result] = await db.execute(
      "UPDATE UserKeys SET FullKey = ?, GuiKey = ?, ServerName = ? WHERE FullKey = ? OR GuiKey = ?",
      [newKey, newGuiKey, newServerName, oldKey, oldKey]
    );

    if (result.affectedRows > 0) {
      console.log("✅ FullKey, GuiKey, and ServerName updated successfully!");
      console.log("👉 New GuiKey:", newGuiKey);
      console.log("👉 New ServerName:", newServerName);
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
