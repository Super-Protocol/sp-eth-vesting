import { ethers } from 'hardhat';

async function main() {
    if (!process.env.INITIALIZER_ADDRESS) {
        throw new Error('INITIALIZER_ADDRESS is not provided');
    }

    const InsiderVesting = await ethers.getContractFactory('InsidersVesting');
    const insiderVesting = await InsiderVesting.deploy(process.env.INITIALIZER_ADDRESS);
    const deployed = await insiderVesting.waitForDeployment();

    console.log('InsiderVesting deployed to:', await deployed.getAddress());
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
