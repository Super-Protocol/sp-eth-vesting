import { task } from 'hardhat/config';
import fs from 'fs';
import '@nomiclabs/hardhat-ethers';
import { BigNumber } from '@ethersproject/bignumber';

interface Beneficiary {
    account: string;
    tokenAmount: BigNumber;
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
        const beneficiaries = JSON.parse(fs.readFileSync(beneficiariesFilename).toString()) as Beneficiary[];

        const txn = await vesting.connect(initializer).initialize(taskArgs.token, beneficiaries, taskArgs.start);
        await txn.wait();

        console.log('Done');
    });
