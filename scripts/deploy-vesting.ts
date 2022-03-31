import { ethers } from 'hardhat';

async function main() {
    if (!process.env.ADMIN_MULTISIG) {
        throw new Error('ADMIN_MULTISIG is not provided');
    }

    const Vesting = await ethers.getContractFactory('Vesting');
    const vesting = await Vesting.deploy(process.env.ADMIN_MULTISIG);
    await vesting.deployed();

    console.log('Vesting deployed to:', vesting.address);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
