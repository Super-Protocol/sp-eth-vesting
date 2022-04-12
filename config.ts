import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '/.env') });

export const config = {
    rinkebyUrl: process.env.RINKEBY_URL,
    mumbaiUrl: process.env.MUMBAI_URL,
    mainnetUrl: process.env.MAINNET_URL,
    testPrivateKey: process.env.TEST_PRIVATE_KEY,
    privateKey: process.env.PRIVATE_KEY,
    etherscanApiKey: process.env.ETHERSCAN_API_KEY,
    polygonscanApiKey: process.env.POLYGONSCAN_API_KEY,
};
