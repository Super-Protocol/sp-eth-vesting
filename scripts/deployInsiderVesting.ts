import { ethers } from 'hardhat';

async function main() {
    if (!process.env.INITIALIZER) {
        throw new Error('INITIALIZER is not provided');
    }

    const InsiderVesting = await ethers.getContractFactory('InsidersVesting');
    const insiderVesting = await InsiderVesting.deploy(process.env.INITIALIZER);
    await insiderVesting.deployed();

    console.log('InsiderVesting deployed to:', insiderVesting.address);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
