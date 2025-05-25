const axios = require('axios');
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'; // only for testing
const apiUrl = ''; // Replace with your actual API URL Format: https://1.23.456.789:12345/
const apiKey = 'OUUogg5tZIsght_nf2lDpQ/'; // Replace with your actual API key Format: https://domain:port/"OUUogg5tZIsght_nf2lDpQ/"

async function createNewKey() {
    try {
        const response = await axios.post(
            `${apiUrl}/OUUogg5tZIsght_nf2lDpQ/access-keys`,
            {},
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-outline-access-key': apiKey,
                },
            }
        );

        if (response.status === 201) {
            console.log('✅ New access key created:', response.data.accessUrl);
        } else {
            console.error('❌ Unexpected response:', response.status, response.data);
        }
    } catch (error) {
        if (error.response) {
            console.error('❌ API error response:', error.response.status, error.response.data);
        } else {
            console.error('❌ Request error:', error.message);
        }
    }
}



createNewKey();
