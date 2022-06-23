import { task } from 'hardhat/config';
import '@nomiclabs/hardhat-ethers';

task('initialize-vesting', 'Initialize Vesting contract')
    .addParam('contract', 'Address of deployed vesting contract')
    .addParam('token', 'Address of current token contract')
    .addParam('start', 'Timestamp of the date, when vesting will start')
    .addParam('finish', 'Timestamp of the date, when vesting will finish')
    .setAction(async (taskArgs, { ethers }) => {
        const [initializer] = await ethers.getSigners();
        const vesting = await ethers.getContractAt('Vesting', taskArgs.contract);
        const txn = await vesting.connect(initializer).initialize(taskArgs.token, taskArgs.start, taskArgs.finish);
        await txn.wait();

        console.log('Done');
    });
