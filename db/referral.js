// db/referral.js
//
// All database access for the referral / invite program: generating and
// looking up invite codes, setting/clearing who invited a user, and
// crediting the reward when an invited user makes a purchase.
//
// Usage:
//   const referralDb = require('./db/referral');
//   const code = await referralDb.getOrCreateReferralCode(db, userId);
const config = require('../referral');
const { columnFor, formatMoney } = require('../currency');

/**
 * Usage:
 *   randomPercentInRange()   // -> a number between REWARD_PERCENT_MIN and
 *                             //    REWARD_PERCENT_MAX (inclusive of the
 *                             //    min, exclusive of the max), a fresh
 *                             //    pick every call.
 * Guards against a misconfigured referral.js (max < min) by swapping
 * them rather than silently producing a negative-width range.
 */
function randomPercentInRange() {
    const lo = Math.min(config.REWARD_PERCENT_MIN, config.REWARD_PERCENT_MAX);
    const hi = Math.max(config.REWARD_PERCENT_MIN, config.REWARD_PERCENT_MAX);
    return lo + Math.random() * (hi - lo);
}

/**
 * Usage:
 *   const code = await generateUniqueCode(db);   // -> e.g. "7KTXPQ"
 * Retries a few times on a collision (astronomically unlikely at 6
 * characters from a 32-character alphabet, but a collision must never
 * silently overwrite someone else's code).
 */
async function generateUniqueCode(db) {
    for (let attempt = 0; attempt < 10; attempt++) {
        let code = '';
        for (let i = 0; i < config.CODE_LENGTH; i++) {
            code += config.CODE_ALPHABET[Math.floor(Math.random() * config.CODE_ALPHABET.length)];
        }
        const [rows] = await db.execute('SELECT 1 FROM referrals WHERE ReferralCode = ? LIMIT 1', [code]);
        if (rows.length === 0) return code;
    }
    throw new Error('Could not generate a unique referral code after 10 attempts.');
}

/**
 * Usage:
 *   const code = await getOrCreateReferralCode(db, userId);
 * Every user gets exactly one code, created the first time they're looked
 * up (typically the first time they open /referral). Safe to call
 * repeatedly — returns the existing code on every call after the first.
 */
async function getOrCreateReferralCode(db, userId) {
    const [rows] = await db.execute('SELECT ReferralCode FROM referrals WHERE UserID = ? LIMIT 1', [userId]);
    if (rows.length > 0) return rows[0].ReferralCode;

    const code = await generateUniqueCode(db);
    try {
        await db.execute('INSERT INTO referrals (UserID, ReferralCode) VALUES (?, ?)', [userId, code]);
        return code;
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            // Someone else's request created this user's row in the tiny
            // gap between the SELECT above and this INSERT (e.g. two
            // /referral taps at once) — just read back what won the race.
            const [rows2] = await db.execute('SELECT ReferralCode FROM referrals WHERE UserID = ? LIMIT 1', [userId]);
            if (rows2.length > 0) return rows2[0].ReferralCode;
        }
        throw err;
    }
}

/**
 * Usage:
 *   const info = await getReferralInfo(db, userId);
 *   // { code, referredByUserId, referredByUsername, inviteCount, totals: { USD, IRC } }
 * Creates the user's own code if they don't have one yet (see above).
 */
async function getReferralInfo(db, userId) {
    const code = await getOrCreateReferralCode(db, userId);

    const [rows] = await db.execute(
        `SELECT r.ReferredByUserID, a.Username AS ReferredByUsername
         FROM referrals r
         LEFT JOIN accounts a ON a.UserID = r.ReferredByUserID
         WHERE r.UserID = ?
         LIMIT 1`,
        [userId]
    );
    const referredByUserId = rows[0]?.ReferredByUserID || null;
    const referredByUsername = rows[0]?.ReferredByUsername || null;

    const [[{ inviteCount }]] = await db.execute(
        'SELECT COUNT(*) AS inviteCount FROM referrals WHERE ReferredByUserID = ?',
        [userId]
    );

    const [totalsRows] = await db.execute(
        'SELECT Currency, SUM(RewardAmount) AS total FROM referral_rewards WHERE InviterUserID = ? GROUP BY Currency',
        [userId]
    );
    const totals = { USD: 0, IRC: 0 };
    totalsRows.forEach(r => { totals[r.Currency] = Number(r.total) || 0; });

    return { code, referredByUserId, referredByUsername, inviteCount, totals };
}

/**
 * Usage:
 *   const isCycle = await wouldCreateCycle(db, proposedInviterId, userId);
 *
 * Walks the "invited by" chain starting at proposedInviterId (their
 * inviter, then THAT person's inviter, and so on). Returns true if the
 * chain ever leads back to userId — meaning userId setting
 * proposedInviterId as their own inviter would close a loop, direct
 * (A invites B, B invites A) or longer (A invites B invites C invites
 * A). Every UserID is compared as a String: mysql2 returns BIGINT
 * columns as JS strings by default, while Telegram's msg.from.id is
 * always a JS Number — comparing them with === would silently never
 * match, which is exactly the bug that let the direct A/B case through
 * before this function existed.
 *
 * Capped at 100 hops so a data problem elsewhere (an existing cycle
 * this function didn't create) can't spin forever; hitting the cap is
 * treated as "not a cycle" rather than blocking a legitimate long chain.
 */
async function wouldCreateCycle(db, proposedInviterId, userId) {
    const target = String(userId);
    let current = String(proposedInviterId);
    const visited = new Set();

    for (let hops = 0; hops < 100; hops++) {
        if (current === target) return true;
        if (visited.has(current)) return false; // pre-existing cycle elsewhere; not this call's concern
        visited.add(current);

        const [rows] = await db.execute('SELECT ReferredByUserID FROM referrals WHERE UserID = ? LIMIT 1', [current]);
        const next = rows[0]?.ReferredByUserID;
        if (next == null) return false;
        current = String(next);
    }
    return false;
}

/**
 * Usage:
 *   const result = await setReferredBy(db, userId, 'abc123');
 *   // { ok: true,  inviterUserId, inviterLabel }
 *   // { ok: false, error: '...' }
 * Can be called at any time, including to CHANGE an existing value —
 * there is no lock-after-first-set here, by design (see the /referral
 * handler for the user-facing flow this backs). What IS blocked, always:
 * inviting yourself, and inviting anyone whose own "invited by" chain
 * already leads back to you (a loop, direct or longer).
 */
async function setReferredBy(db, userId, codeInput) {
    const code = String(codeInput || '').trim().toUpperCase();
    if (!code) return { ok: false, error: 'Please send a code.' };

    const [rows] = await db.execute('SELECT UserID FROM referrals WHERE ReferralCode = ? LIMIT 1', [code]);
    if (rows.length === 0) return { ok: false, error: `No invite code "${code}" found.` };

    const inviterUserId = rows[0].UserID;
    if (String(inviterUserId) === String(userId)) return { ok: false, error: "You can't use your own invite code." };

    if (await wouldCreateCycle(db, inviterUserId, userId)) {
        return { ok: false, error: "That would create a referral loop — that invite code already leads back to you." };
    }

    // Make sure the invited user has their own row/code before pointing it
    // at an inviter (getOrCreateReferralCode is a no-op if it already exists).
    await getOrCreateReferralCode(db, userId);

    await db.execute('UPDATE referrals SET ReferredByUserID = ? WHERE UserID = ?', [inviterUserId, userId]);

    const [inviterRows] = await db.execute('SELECT Username FROM accounts WHERE UserID = ? LIMIT 1', [inviterUserId]);
    const inviterLabel = inviterRows[0]?.Username ? '@' + inviterRows[0].Username : `UserID ${inviterUserId}`;

    return { ok: true, inviterUserId, inviterLabel };
}

/**
 * Usage:
 *   await clearReferredBy(db, userId);
 * Removes the "invited by" relationship without deleting the user's own
 * invite code or their list of people they themselves invited.
 */
async function clearReferredBy(db, userId) {
    await getOrCreateReferralCode(db, userId);
    await db.execute('UPDATE referrals SET ReferredByUserID = NULL WHERE UserID = ?', [userId]);
}

/**
 * Usage (called once, right after a purchase's deductBalance() succeeds):
 *   const result = await creditReferralReward(db, bot, userId, payment.currency, payment.amount, 'Outline');
 *   // { credited: true,  inviterUserId, rewardAmount, currency }
 *   // { credited: false, reason: 'no-inviter' | 'already-rewarded-once' | 'no-flat-configured' | 'zero-reward' | 'error' }
 *
 * Best-effort and self-contained: this NEVER throws. A referral-reward
 * failure must never break or roll back the purchase that triggered it,
 * so every error is caught, logged, and reported back as
 * { credited: false, reason: 'error' } instead of propagating.
 */
async function creditReferralReward(db, bot, invitedUserId, currency, purchaseAmount, purchaseType) {
    try {
        const [rows] = await db.execute('SELECT ReferredByUserID FROM referrals WHERE UserID = ? LIMIT 1', [invitedUserId]);
        const inviterUserId = rows[0]?.ReferredByUserID;
        if (!inviterUserId) return { credited: false, reason: 'no-inviter' };

        if (!config.REWARD_EVERY_PURCHASE) {
            const [existing] = await db.execute(
                'SELECT 1 FROM referral_rewards WHERE InvitedUserID = ? LIMIT 1',
                [invitedUserId]
            );
            if (existing.length > 0) return { credited: false, reason: 'already-rewarded-once' };
        }

        let rewardAmount;
        if (config.REWARD_MODE === 'flat') {
            rewardAmount = config.REWARD_FLAT[currency];
            if (!rewardAmount) return { credited: false, reason: 'no-flat-configured' };
        } else {
            rewardAmount = Number(purchaseAmount) * (randomPercentInRange() / 100);
        }
        rewardAmount = currency === 'IRC' ? Math.round(rewardAmount) : Math.round(rewardAmount * 100) / 100;
        if (!(rewardAmount > 0)) return { credited: false, reason: 'zero-reward' };

        const col = columnFor(currency); // fixed whitelist -> safe to interpolate

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query(`UPDATE accounts SET ${col} = ${col} + ? WHERE UserID = ?`, [rewardAmount, inviterUserId]);
            await conn.query(
                `INSERT INTO referral_rewards (InviterUserID, InvitedUserID, PurchaseType, Currency, PurchaseAmount, RewardAmount)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [inviterUserId, invitedUserId, purchaseType, currency, purchaseAmount, rewardAmount]
            );
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        if (config.NOTIFY_INVITER && bot) {
            try {
                await bot.sendMessage(
                    inviterUserId,
                    `🎉 Someone you invited just made a purchase!\nYou earned ${formatMoney(currency, rewardAmount)}.`
                );
            } catch (notifyErr) {
                console.error(`Referral notify failed for UserID ${inviterUserId}:`, notifyErr.message);
            }
        }

        return { credited: true, inviterUserId, rewardAmount, currency };
    } catch (err) {
        console.error('creditReferralReward error:', err);
        return { credited: false, reason: 'error', error: err.message };
    }
}

module.exports = {
    getOrCreateReferralCode,
    getReferralInfo,
    setReferredBy,
    clearReferredBy,
    creditReferralReward
};
