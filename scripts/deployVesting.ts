import { ethers } from 'hardhat';

async function main() {
    if (!process.env.INITIALIZER) {
        throw new Error('INITIALIZER is not provided');
    }

    const Vesting = await ethers.getContractFactory('Vesting');
    const vesting = await Vesting.deploy(process.env.INITIALIZER);
    await vesting.deployed();

    console.log('Vesting deployed to:', vesting.address);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
