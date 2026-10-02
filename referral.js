// referral.js
//
// Configuration for the referral / invite program: what a generated
// invite code looks like, and how much an inviter earns when someone
// they invited makes a purchase.
//
// Usage:
//   const referral = require('./referral');
//   if (referral.REWARD_MODE === 'percent') { ... }

module.exports = {
    // Length of a generated invite code (characters from CODE_ALPHABET).
    CODE_LENGTH: 6,

    // Characters a generated code can contain. 0/O and 1/I/L are left out
    // on purpose — easy to misread or mistype, especially read aloud.
    CODE_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',

    // 'percent' -> reward = purchaseAmount * (a fresh random percent between
    //              REWARD_PERCENT_MIN and REWARD_PERCENT_MAX, picked
    //              independently for every purchase) / 100, in the SAME
    //              currency the purchase was paid in.
    // 'flat'    -> reward = REWARD_FLAT[<purchase currency>], regardless
    //              of how much was actually spent.
    REWARD_MODE: 'percent',
    REWARD_PERCENT_MIN: 2,                    // lower bound, used when REWARD_MODE === 'percent'
    REWARD_PERCENT_MAX: 2.5,                  // upper bound, used when REWARD_MODE === 'percent'
    REWARD_FLAT: { USD: 0.05, IRC: 20000 },   // used when REWARD_MODE === 'flat'

    // true  -> the inviter earns a reward on EVERY purchase the invited
    //          user makes, for as long as that invite relationship stands.
    // false -> only the invited user's FIRST rewarded purchase pays out;
    //          every purchase after that earns nothing for the inviter.
    REWARD_EVERY_PURCHASE: true,

    // DM the inviter each time they earn a reward.
    NOTIFY_INVITER: true
};
