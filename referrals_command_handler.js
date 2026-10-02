// referrals_command_handler.js
//
// Usage:
//   const registerReferralsReportCommand = require('./referrals_command_handler');
//   registerReferralsReportCommand(bot, { db });
//
// Registers "/referrals <username|UserID>" — an ADMIN report on one
// person's referral performance: their invite code, everyone who used
// it (with a tap-to-copy UserID and the date each invitee first opened
// the bot), and how much the inviter earned from each of them, split
// into this-month and all-time. Distinct from the customer-facing
// "/referral" (singular) command in referral_handler.js, which shows a
// user their OWN code/status and lets them set who invited them.
//
// ACCESS: superadmin + admin only (moderator excluded) — same gate as
// /checkbalance, /useridADDbalance, etc. This reads another person's
// earnings and every user who used their code, so it must not be open
// to moderators or regular users.
//
// Usage examples:
//   /referrals                 -> shows usage instructions
//   /referrals alice           -> report for @alice (by username)
//   /referrals @alice          -> same, leading @ is optional
//   /referrals 123456789       -> report for UserID 123456789
//
// Design notes:
//   - "This month" means calendar-month-to-date (from the 1st of the
//     current month), not a rolling 30 days. If a rolling window is
//     wanted instead, change MONTH_START_SQL below.
//   - One query gets every invitee's per-currency, this-month/overall
//     reward totals at once (GROUP BY InvitedUserID, Currency) instead
//     of looping a query per invitee — the invitee count is unbounded,
//     and this keeps it to a fixed 3 queries regardless of how many
//     there are.
//   - The grand totals shown in the header are summed in JS from that
//     same result set, so they never need a 4th query and can never
//     disagree with the per-invitee numbers below them.
//   - Long invitee lists are split across multiple Telegram messages
//     the same way /keyusername and /keyuserid already do, and sent
//     through the same "log the real reason, fall back to plain text"
//     safety net — duplicated locally rather than imported, matching
//     this codebase's existing convention for these small handler
//     files (see the escapeHtml comment in keystatus_handler.js).
const registry = require('./commandRegistry');
const { formatMoney } = require('./currency');

registry.register(
    '/referrals <username|UserID> | all | active | bond <inviterID> <inviteeID>',
    "invitees, join dates, and rewards earned; 'all'/'active' list every/only active inviters; 'bond' drills into one pair's transactions",
    ['superadmin', 'admin'],
    'Account'
);

// SQL expression for "the first moment of the current calendar month".
const MONTH_START_SQL = "DATE_FORMAT(CURDATE(), '%Y-%m-01')";

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function telegramErrorDetail(err) {
    return err?.response?.body?.description || err?.message || err?.code || 'Unknown error';
}

// Usage: for (const part of messages) await sendHtmlPartSafely(bot, chatId, part);
// Same fallback behaviour as commands.js's sendHtmlPartSafely: on an
// entity-parsing rejection, log the exact text and resend as plain text
// instead of failing outright.
async function sendHtmlPartSafely(bot, chatId, part) {
    try {
        await bot.sendMessage(chatId, part, { parse_mode: 'HTML' });
    } catch (err) {
        const detail = telegramErrorDetail(err);
        if (!/can't parse entities/i.test(detail)) throw err;
        console.error('HTML parse error — exact text that failed to send:\n' + part);
        console.error('Telegram said:', detail);
        await bot.sendMessage(chatId, `⚠️ (formatting removed — Telegram rejected the HTML: ${detail})\n\n${part.replace(/<[^>]+>/g, '')}`);
    }
}

// Usage: formatDate('2026-09-15T00:00:00Z') -> '2026-09-15'  (falls back to the raw value if unparseable)
function formatDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

/**
 * Usage:
 *   formatInviteeLabel({ FirstName: 'Daniel', LastName: 'Smith', Username: 'DSmith' })
 *     -> 'Daniel Smith - @DSmith'
 *   formatInviteeLabel({ FirstName: 'Daniel', LastName: '', Username: null })
 *     -> 'Daniel'
 *   formatInviteeLabel({ FirstName: '', LastName: '', Username: 'DSmith' })
 *     -> '@DSmith'
 *   formatInviteeLabel({ FirstName: '', LastName: '', Username: null })
 *     -> '<i>Unknown Name</i>'
 * Full name and username shown together when both exist, name only, or
 * username only when just one exists — never both missing without a
 * fallback label.
 */
function formatPersonLabel(person) {
    const fullName = `${person.FirstName || ''} ${person.LastName || ''}`.trim();
    const usernamePart = person.Username ? '@' + escapeHtml(person.Username) : null;

    if (fullName && usernamePart) return `${escapeHtml(fullName)} - ${usernamePart}`;
    if (fullName) return escapeHtml(fullName);
    if (usernamePart) return usernamePart;
    return '<i>Unknown Name</i>';
}

// Usage: formatInviteeLabel(inv) -- kept as a name for the single-target
// report's call sites; identical formatting to formatPersonLabel above.
function formatInviteeLabel(inv) {
    return formatPersonLabel(inv);
}

// Usage: await sleep(300);
// A short pause between successive sendMessage calls to the SAME chat.
// Telegram's flood-control limit for one chat is roughly one message per
// second sustained — the "/referrals all" report can produce many
// messages for a large user base, and sending them back-to-back with no
// gap risks a 429 (Too Many Requests) partway through the report.
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Usage:
 *   await sendAllUsersReport(bot, chatId, db, 'all');     // "/referrals all"    -> every user
 *   await sendAllUsersReport(bot, chatId, db, 'active');  // "/referrals active" -> only users with >=1 invitee
 *
 * Both modes share the exact same data-gathering and per-invitee display
 * (name/username/UserID, this-month + overall rewards) — 'active' just
 * filters the top-level list down to inviters who actually have someone
 * under them. Three queries total regardless of user count: every
 * account, every referral edge (InvitedUserID -> ReferredByUserID), and
 * every (inviter, invitee) pair's reward totals — everything else is
 * built in memory rather than querying per user.
 *
 * A user's own entry plus their FULL invitee list is always kept inside
 * ONE appendChunk call, so a message boundary can split BETWEEN two
 * users but never in the middle of one user's invitee list.
 */
// Usage: emptyTotals() -> { USD: { month: 0, overall: 0 }, IRC: { month: 0, overall: 0 } }
// A fresh, independent zeroed object every call — callers mutate the result,
// so this must never return a shared reference.
function emptyTotals() {
    return { USD: { month: 0, overall: 0 }, IRC: { month: 0, overall: 0 } };
}

async function sendAllUsersReport(bot, chatId, db, mode) {
    const [accounts] = await db.execute(
        'SELECT UserID, Username, FirstName, LastName FROM accounts ORDER BY UserID ASC'
    );
    const [edges] = await db.execute(
        'SELECT UserID AS InvitedUserID, ReferredByUserID FROM referrals WHERE ReferredByUserID IS NOT NULL'
    );
    // Every (inviter, invitee) pair's reward totals, ONE query for the
    // whole report rather than one query per invitee.
    const [rewardRows] = await db.execute(
        `SELECT InviterUserID, InvitedUserID, Currency,
                SUM(RewardAmount) AS overallTotal,
                SUM(CASE WHEN CreatedAt >= ${MONTH_START_SQL} THEN RewardAmount ELSE 0 END) AS monthTotal
         FROM referral_rewards
         GROUP BY InviterUserID, InvitedUserID, Currency`
    );

    const accountsById = {};
    accounts.forEach(a => { accountsById[a.UserID] = a; });

    // inviteesByInviter[InviterUserID] -> array of invitee account rows
    const inviteesByInviter = {};
    edges.forEach(e => {
        const invitee = accountsById[e.InvitedUserID];
        if (!invitee) return; // referrals row with no matching account (shouldn't happen; skip defensively)
        (inviteesByInviter[e.ReferredByUserID] ??= []).push(invitee);
    });

    // rewardsByPair['<inviter>:<invitee>'] = { USD: {month, overall}, IRC: {month, overall} }
    const rewardsByPair = {};
    rewardRows.forEach(row => {
        const key = `${row.InviterUserID}:${row.InvitedUserID}`;
        rewardsByPair[key] ??= emptyTotals();
        rewardsByPair[key][row.Currency] = {
            month: Number(row.monthTotal) || 0,
            overall: Number(row.overallTotal) || 0
        };
    });

    // 'active' drops everyone with zero invitees from the TOP-LEVEL list.
    // (Nothing about an invitee's own row changes — someone who was
    // invited but has never invited anyone themselves still won't get
    // their own top-level entry, same as in 'all'.)
    const rows = mode === 'active'
        ? accounts.filter(person => (inviteesByInviter[person.UserID] || []).length > 0)
        : accounts;

    const MAX = 3500;
    const messages = [];
    const title = mode === 'active'
        ? `📋 <b>Active Inviters</b> (${rows.length} of ${accounts.length} users)\n\n`
        : `📋 <b>All Users &amp; Their Invitees</b> (${rows.length} total)\n\n`;
    let response = title;

    const appendChunk = (entry) => {
        if (response.length + entry.length > MAX) {
            messages.push(response);
            response = '';
        }
        response += entry;
    };

    rows.forEach((person, i) => {
        let entry = `${i + 1}. ${formatPersonLabel(person)} — UserID: <code>${person.UserID}</code>\n`;
        const invitees = inviteesByInviter[person.UserID] || [];
        if (invitees.length === 0) {
            entry += `   ↳ No invitees\n\n`;
        } else {
            entry += `   ↳ Invited:\n`;
            invitees.forEach(inv => {
                const totals = rewardsByPair[`${person.UserID}:${inv.UserID}`] || emptyTotals();
                entry +=
                    `   • ${formatPersonLabel(inv)} — UserID: <code>${inv.UserID}</code>\n` +
                    `     This month: ${formatMoney('USD', totals.USD.month)} | ${formatMoney('IRC', totals.IRC.month)}\n` +
                    `     Overall: ${formatMoney('USD', totals.USD.overall)} | ${formatMoney('IRC', totals.IRC.overall)}\n`;
            });
            entry += `\n`;
        }
        appendChunk(entry);
    });

    if (response.length > 0) messages.push(response);

    for (let i = 0; i < messages.length; i++) {
        await sendHtmlPartSafely(bot, chatId, messages[i]);
        if (i < messages.length - 1) await sleep(300); // flood-control safety between chunks
    }
}

/**
 * Usage: await sendBondReport(bot, chatId, db, '111111111', '222222222');
 *
 * "/referrals bond <inviterID> <inviteeID>" — every individual purchase
 * that has ever generated a reward between this ONE specific pair, most
 * recent first, with the reward amount AND the effective percent that
 * transaction actually used (RewardAmount / PurchaseAmount * 100) —
 * useful now that the percent is randomized per purchase (see
 * referral.js's REWARD_PERCENT_MIN/MAX) rather than a single fixed rate.
 *
 * Shows every row that was EVER recorded for this exact pair, even if
 * the invitee has since changed who invited them (ReferredByUserID is
 * always editable — see db/referral.js) — this is a historical ledger,
 * not a live relationship check. If the pair is no longer currently
 * linked, a note says so, but the transactions still show.
 */
async function sendBondReport(bot, chatId, db, inviterUserId, inviteeUserId) {
    const [accRows] = await db.execute(
        'SELECT UserID, Username, FirstName, LastName FROM accounts WHERE UserID IN (?, ?)',
        [inviterUserId, inviteeUserId]
    );
    const byId = {};
    accRows.forEach(a => { byId[a.UserID] = a; });

    const inviter = byId[inviterUserId] || { UserID: inviterUserId, Username: null, FirstName: '', LastName: '' };
    const invitee = byId[inviteeUserId] || { UserID: inviteeUserId, Username: null, FirstName: '', LastName: '' };

    const [linkRows] = await db.execute('SELECT ReferredByUserID FROM referrals WHERE UserID = ? LIMIT 1', [inviteeUserId]);
    const currentlyLinked = linkRows[0]?.ReferredByUserID != null && String(linkRows[0].ReferredByUserID) === String(inviterUserId);

    const [rows] = await db.execute(
        `SELECT PurchaseType, Currency, PurchaseAmount, RewardAmount, CreatedAt
         FROM referral_rewards
         WHERE InviterUserID = ? AND InvitedUserID = ?
         ORDER BY CreatedAt DESC`,
        [inviterUserId, inviteeUserId]
    );

    const totals = emptyTotals();
    const monthCutoff = new Date();
    monthCutoff.setDate(1);
    monthCutoff.setHours(0, 0, 0, 0);

    const MAX = 3500;
    const messages = [];
    let response =
        `🔗 <b>Referral Bond</b>\n` +
        `Inviter: ${formatPersonLabel(inviter)} — UserID: <code>${inviter.UserID}</code>\n` +
        `Invitee: ${formatPersonLabel(invitee)} — UserID: <code>${invitee.UserID}</code>\n` +
        (currentlyLinked ? '' : `⚠️ <i>Not currently linked — showing historical transactions only.</i>\n`) +
        `\nTransactions: ${rows.length}\n\n`;

    const appendChunk = (entry) => {
        if (response.length + entry.length > MAX) {
            messages.push(response);
            response = '';
        }
        response += entry;
    };

    if (rows.length === 0) {
        appendChunk('ℹ️ No transactions between these two users yet.\n');
    } else {
        rows.forEach((row, i) => {
            const purchase = Number(row.PurchaseAmount) || 0;
            const reward = Number(row.RewardAmount) || 0;
            const pct = purchase > 0 ? ((reward / purchase) * 100).toFixed(2) + '%' : 'n/a';
            const isThisMonth = new Date(row.CreatedAt) >= monthCutoff;

            totals[row.Currency].overall += reward;
            if (isThisMonth) totals[row.Currency].month += reward;

            appendChunk(
                `${i + 1}. ${escapeHtml(formatDate(row.CreatedAt))} — ${escapeHtml(row.PurchaseType)}\n` +
                `   Purchase: ${formatMoney(row.Currency, purchase)}\n` +
                `   Reward: ${formatMoney(row.Currency, reward)} (${pct} applied)\n\n`
            );
        });
    }

    const summary =
        `\n📊 Total this month: ${formatMoney('USD', totals.USD.month)} | ${formatMoney('IRC', totals.IRC.month)}\n` +
        `📊 Total overall: ${formatMoney('USD', totals.USD.overall)} | ${formatMoney('IRC', totals.IRC.overall)}`;
    appendChunk(summary);

    if (response.length > 0) messages.push(response);

    for (let i = 0; i < messages.length; i++) {
        await sendHtmlPartSafely(bot, chatId, messages[i]);
        if (i < messages.length - 1) await sleep(300);
    }
}

module.exports = function registerReferralsReportCommand(bot, deps) {
    const { db } = deps;

    bot.onText(/^\/referrals(?:\s+([\s\S]+))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const tokens = match[1] ? match[1].trim().split(/\s+/) : [];

        const USAGE =
            '⚠️ Usage:\n' +
            '/referrals <username|UserID>          - one person\'s invitees + rewards\n' +
            '/referrals all                        - every user, with who they invited + rewards\n' +
            '/referrals active                     - only users who have invited at least 1 person\n' +
            '/referrals bond <inviterID> <inviteeID> - every transaction between one specific pair\n\n' +
            'Examples:\n/referrals alice\n/referrals 123456789\n/referrals all\n/referrals active\n/referrals bond 111111111 222222222';

        try {
            // --- superadmin / admin gate (moderator excluded) ---
            const [adminRows] = await db.execute(
                "SELECT Role FROM Admins WHERE UserID = ? AND IsActive = 1 LIMIT 1",
                [senderId]
            );
            if (adminRows.length === 0 || !['superadmin', 'admin'].includes(adminRows[0].Role)) {
                await bot.sendMessage(chatId, '❌ Error: This command is restricted to superadmins and admins.');
                return;
            }

            if (tokens.length === 0) {
                await bot.sendMessage(chatId, USAGE);
                return;
            }

            const mode = tokens[0].toLowerCase();

            if (mode === 'all' || mode === 'active') {
                if (tokens.length !== 1) { await bot.sendMessage(chatId, USAGE); return; }
                await sendAllUsersReport(bot, chatId, db, mode);
                return;
            }

            if (mode === 'bond') {
                if (tokens.length !== 3 || !/^\d+$/.test(tokens[1]) || !/^\d+$/.test(tokens[2])) {
                    await bot.sendMessage(chatId, USAGE);
                    return;
                }
                await sendBondReport(bot, chatId, db, tokens[1], tokens[2]);
                return;
            }

            if (tokens.length !== 1) {
                await bot.sendMessage(chatId, USAGE);
                return;
            }

            const arg = tokens[0].replace(/^@/, '');

            // --- Resolve the target (accepts either a UserID or a username) ---
            const [targetRows] = /^\d+$/.test(arg)
                ? await db.execute('SELECT UserID, Username FROM accounts WHERE UserID = ? LIMIT 1', [arg])
                : await db.execute('SELECT UserID, Username FROM accounts WHERE LOWER(Username) = LOWER(?) LIMIT 1', [arg]);

            if (targetRows.length === 0) {
                await bot.sendMessage(chatId, `⚠️ No account found for: ${escapeHtml(arg)}`);
                return;
            }

            const target = targetRows[0];
            const targetLabel = target.Username ? '@' + target.Username : `UserID ${target.UserID}`;

            // --- Target's own invite code, if they've ever opened /referral ---
            const [codeRows] = await db.execute('SELECT ReferralCode FROM referrals WHERE UserID = ? LIMIT 1', [target.UserID]);
            const referralCode = codeRows[0]?.ReferralCode || null;

            // --- Everyone who has this person as ReferredByUserID ---
            const [invitees] = await db.execute(
                `SELECT r.UserID, a.Username, a.FirstName, a.LastName, a.CreatedAt AS JoinedAt
                 FROM referrals r
                 JOIN accounts a ON a.UserID = r.UserID
                 WHERE r.ReferredByUserID = ?
                 ORDER BY a.CreatedAt DESC`,
                [target.UserID]
            );

            // --- Per-invitee, per-currency reward totals in ONE query ---
            const [rewardRows] = await db.execute(
                `SELECT InvitedUserID, Currency,
                        SUM(RewardAmount) AS overallTotal,
                        SUM(CASE WHEN CreatedAt >= ${MONTH_START_SQL} THEN RewardAmount ELSE 0 END) AS monthTotal
                 FROM referral_rewards
                 WHERE InviterUserID = ?
                 GROUP BY InvitedUserID, Currency`,
                [target.UserID]
            );

            // rewardsByInvitee[UserID] = { USD: { month, overall }, IRC: { month, overall } }
            const rewardsByInvitee = {};
            const grandTotal = { USD: { month: 0, overall: 0 }, IRC: { month: 0, overall: 0 } };
            for (const row of rewardRows) {
                rewardsByInvitee[row.InvitedUserID] ??= { USD: { month: 0, overall: 0 }, IRC: { month: 0, overall: 0 } };
                rewardsByInvitee[row.InvitedUserID][row.Currency] = {
                    month: Number(row.monthTotal) || 0,
                    overall: Number(row.overallTotal) || 0
                };
                grandTotal[row.Currency].month += Number(row.monthTotal) || 0;
                grandTotal[row.Currency].overall += Number(row.overallTotal) || 0;
            }

            // --- Build the message(s), chunked to stay under Telegram's limit ---
            const MAX = 3500;
            const messages = [];
            let response =
                `🎁 <b>Referral Report</b> — ${escapeHtml(targetLabel)} (UserID: <code>${target.UserID}</code>)\n` +
                `Invite code: ${referralCode ? `<code>${escapeHtml(referralCode)}</code>` : '<i>not generated yet</i>'}\n` +
                `Invitees: ${invitees.length}\n\n` +
                `📊 Total this month: ${formatMoney('USD', grandTotal.USD.month)} | ${formatMoney('IRC', grandTotal.IRC.month)}\n` +
                `📊 Total overall: ${formatMoney('USD', grandTotal.USD.overall)} | ${formatMoney('IRC', grandTotal.IRC.overall)}\n\n`;

            const appendChunk = (entry) => {
                if (response.length + entry.length > MAX) {
                    messages.push(response);
                    response = '';
                }
                response += entry;
            };

            if (invitees.length === 0) {
                appendChunk('ℹ️ No one has used this invite code yet.\n');
            } else {
                invitees.forEach((inv, i) => {
                    const totals = rewardsByInvitee[inv.UserID] || { USD: { month: 0, overall: 0 }, IRC: { month: 0, overall: 0 } };
                    const who = formatInviteeLabel(inv);
                    appendChunk(
                        `${i + 1}. ${who} — UserID: <code>${inv.UserID}</code>\n` +
                        `   Joined: ${escapeHtml(formatDate(inv.JoinedAt))}\n` +
                        `   This month: ${formatMoney('USD', totals.USD.month)} | ${formatMoney('IRC', totals.IRC.month)}\n` +
                        `   Overall: ${formatMoney('USD', totals.USD.overall)} | ${formatMoney('IRC', totals.IRC.overall)}\n\n`
                    );
                });
            }

            if (response.length > 0) messages.push(response);

            for (const part of messages) {
                await sendHtmlPartSafely(bot, chatId, part);
            }

        } catch (err) {
            console.error('/referrals error:', err);
            await bot.sendMessage(chatId, `❌ Error: ${telegramErrorDetail(err)}`);
        }
    });
};
