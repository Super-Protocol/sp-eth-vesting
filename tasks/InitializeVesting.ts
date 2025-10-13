import { task } from 'hardhat/config';

task('initialize-vesting', 'Initialize Vesting contract')
    .addParam('contract', 'Address of deployed vesting contract')
    .addParam('token', 'Address of current token contract')
    .addParam('start', 'Timestamp of the date, when vesting will start')
    .addParam('finish', 'Timestamp of the date, when vesting will finish')
    .setAction(async (taskArgs, { ethers }) => {
        const [initializer] = await ethers.getSigners();
        const balance = await ethers.provider.getBalance(initializer.address);
        console.log('  Initializer', initializer.address, 'balance', ethers.formatEther(balance));
        const vesting = await ethers.getContractAt('Vesting', taskArgs.contract);
        console.log('Vesting owner', await vesting.owner());

        const currentBlockNumber = await ethers.provider.getBlockNumber();
        const block = await ethers.provider.getBlock(currentBlockNumber);
        console.log('Current block timestamp', block?.timestamp);
        const txn = await vesting.connect(initializer).initialize(taskArgs.token, taskArgs.start, taskArgs.finish);
        await txn.wait();

        console.log('Done');
    });
