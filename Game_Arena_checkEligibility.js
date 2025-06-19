const db = require('./db');


async function checkEligibility(userId, chatId, bot) {
    //console.log(`[checkEligibility] Called with userId: ${userId}, chatId: ${chatId}`);

    if (chatId === 542797568 ) {
        //console.log(`[checkEligibility] User is eligible (VIP)`);
        bot.sendMessage(chatId, `✅ Welcome Dear Arkh91.`);
        return true;
    }else if (chatId === 535843169 ) {
        //console.log(`[checkEligibility] User is eligible (VIP)`);
        bot.sendMessage(chatId, `✅ Welcome Dear Nezhade.`);
        return true;
    }


    //console.log(`[checkEligibility] User is NOT eligible`);
    return false;
}

module.exports = checkEligibility;
