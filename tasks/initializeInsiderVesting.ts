import { task } from 'hardhat/config';
import fs from 'fs';

interface BeneficiaryJson {
    account: string;
    tokenAmount: string | number | bigint;
}

task('initialize-insider-vesting', 'Initialize Vesting contract')
    .addParam('contract', 'Address of deployed vesting contract')
    .addParam('token', 'Address of current token contract')
    .addParam('start', 'Timestamp of the date, when vesting will start')
    .addParam('beneficiaries', 'Path to file beneficiaries.json')
    .setAction(async (taskArgs, { ethers }) => {
        const [initializer] = await ethers.getSigners();
        const vesting = await ethers.getContractAt('InsidersVesting', taskArgs.contract);

        const beneficiariesFilename = taskArgs.beneficiaries;
        const parsed = JSON.parse(fs.readFileSync(beneficiariesFilename, 'utf8')) as BeneficiaryJson[];
        const beneficiaries = parsed.map(b => ({
            account: b.account,
            tokenAmount: BigInt(b.tokenAmount as any),
        }));
        const start: bigint = BigInt(taskArgs.start);
        const txn = await vesting.connect(initializer).initialize(taskArgs.token, beneficiaries, start);
        await txn.wait();

        console.log('Done');
    });
