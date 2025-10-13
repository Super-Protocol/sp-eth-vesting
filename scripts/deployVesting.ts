import { ethers } from 'hardhat';

async function main() {
    if (!process.env.INITIALIZER_ADDRESS) {
        throw new Error('INITIALIZER_ADDRESS is not provided');
    }

    const Vesting = await ethers.getContractFactory('Vesting');
    const vesting = await Vesting.deploy(process.env.INITIALIZER_ADDRESS);
    const deployed = await vesting.waitForDeployment();

    console.log('Vesting deployed to:', await deployed.getAddress());
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
