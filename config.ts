import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '/.env') });

export const config = {
    mumbaiDeployerPrivateKey: process.env.MUMBAI_DEPLOYER_PRIVATE_KEY,
    localhostDeployerPrivateKey: process.env.LOCALHOST_DEPLOYER_PRIVATE_KEY,
};