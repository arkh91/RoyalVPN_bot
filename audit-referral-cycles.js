// audit-referral-cycles.js
//
// Usage (run once, from the repo root, on the real database):
//   node audit-referral-cycles.js
//
// READ-ONLY. Scans the entire `referrals` table for self-referrals and
// referral cycles of any length (A invites B invites A; A invites B
// invites C invites A; and so on), and prints who's involved in each
// one plus ready-to-review SQL to break it. Nothing here writes to the
// database — copy whichever UPDATE line you want to actually run.
//
// Why this needs its own script instead of one SQL query: a direct
// self-referral (ReferredByUserID = UserID) can be found with a single
// query —
//   SELECT * FROM referrals WHERE ReferredByUserID = UserID;
// — but a LOOP through two or more people (A invites B, B invites A;
// or longer) can't be found that way without a recursive query your
// MySQL/MariaDB version may not support. This script does the same
// walk in plain JS instead, so it works regardless of DB version.
//
// How a cycle is found: for every user not yet covered by an earlier
// walk, follow their "invited by" chain (their inviter, that person's
// inviter, and so on). If the chain ever revisits a user already seen
// in THIS walk, everything from that repeat onward is the cycle. A
// chain of length 1 that revisits itself immediately is a plain
// self-referral; anything longer is a multi-person loop.
const db = require('./db');

/**
 * Usage:
 *   const cycles = findCycles(rows);
 *   // rows: [{ UserID, ReferredByUserID }, ...] -- every row from `referrals`
 *   // cycles: [ ['111'], ['222','333'], ... ]    -- each inner array is one loop,
 *   //          as UserIDs (strings), in the order the chain visits them
 *
 * Every ID is compared as a String throughout, since mysql2 returns
 * BIGINT columns as JS strings by default — comparing them as Numbers
 * (or against a Number from elsewhere) can silently miss a match.
 */
function findCycles(rows) {
    const referredByOf = {};
    rows.forEach(r => { referredByOf[String(r.UserID)] = r.ReferredByUserID != null ? String(r.ReferredByUserID) : null; });

    const globallySeen = new Set();
    const cycles = [];

    for (const row of rows) {
        const startId = String(row.UserID);
        if (globallySeen.has(startId)) continue;

        const path = [];
        const pathSet = new Set();
        let current = startId;

        while (current != null && !pathSet.has(current)) {
            path.push(current);
            pathSet.add(current);
            globallySeen.add(current);
            current = referredByOf[current] ?? null;
        }

        if (current != null && pathSet.has(current)) {
            cycles.push(path.slice(path.indexOf(current)));
        }
    }

    return cycles;
}

async function main() {
    const [rows] = await db.execute('SELECT UserID, ReferredByUserID FROM referrals');
    const [accountRows] = await db.execute('SELECT UserID, Username, FirstName, LastName FROM accounts');

    const accountsById = {};
    accountRows.forEach(a => { accountsById[String(a.UserID)] = a; });

    const label = (id) => {
        const a = accountsById[id];
        if (!a) return `UserID ${id} (no matching account row)`;
        const name = `${a.FirstName || ''} ${a.LastName || ''}`.trim();
        const uname = a.Username ? '@' + a.Username : null;
        return `${name || uname || 'Unknown'}${name && uname ? ' - ' + uname : ''} — UserID ${id}`;
    };

    const cycles = findCycles(rows);

    if (cycles.length === 0) {
        console.log(`✅ Scanned ${rows.length} referral rows. No self-referrals or cycles found.`);
        return;
    }

    console.log(`⚠️  Scanned ${rows.length} referral rows. Found ${cycles.length} problem(s):\n`);

    cycles.forEach((cycle, i) => {
        const kind = cycle.length === 1 ? 'self-referral' : `${cycle.length}-person loop`;
        console.log(`--- Problem ${i + 1}: ${kind} ---`);
        cycle.forEach(id => console.log('  ' + label(id)));
        console.log('  Fix (run ONE of these — breaking any single link in the loop fixes it):');
        cycle.forEach(id => {
            console.log(`    UPDATE referrals SET ReferredByUserID = NULL WHERE UserID = ${id};  -- breaks ${label(id)}'s link`);
        });
        console.log('');
    });
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('audit-referral-cycles.js failed:', err); process.exit(1); });
