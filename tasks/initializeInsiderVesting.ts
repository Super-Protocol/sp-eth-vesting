import { task } from 'hardhat/config';
import fs from 'fs';
import { parseEther, formatEther } from 'ethers';

interface BeneficiaryJson {
    account: string;
    tokenAmount: string | number | bigint;
}

task('initialize-insider-vesting', 'Initialize Vesting contract')
    .addParam('contract', 'Address of deployed vesting contract')
    .addParam('token', 'Address of current token contract')
    .addParam('start', 'Timestamp of the date, when vesting will start')
    .addParam('vestingLookupDuration', 'Timestamp of the date, when vesting will start')
    .addParam('vestingDuration', 'Timestamp of the date, when vesting will start')
    .addParam('beneficiaries', 'Path to file beneficiaries.json')
    .setAction(async (taskArgs, { ethers }) => {
        const [initializer] = await ethers.getSigners();
        const vesting = await ethers.getContractAt('InsidersVesting', taskArgs.contract);

        const beneficiariesFilename = taskArgs.beneficiaries;
        const parsed = JSON.parse(fs.readFileSync(beneficiariesFilename, 'utf8')) as BeneficiaryJson[];
        const beneficiaries = parsed.map(b => ({
            account: b.account,
            tokenAmount: ethers.parseEther(b.tokenAmount.toString()),
        }));
        const start: bigint = BigInt(taskArgs.start);
        const txn = await vesting
            .connect(initializer)
            .initialize(taskArgs.token, beneficiaries, start, taskArgs.vestingLookupDuration, taskArgs.vestingDuration);
        await txn.wait();

        console.log('Done');
    });

enum VestingType {
    Duration24m,
    Duration36m,
}
type BeneficiarType = {
    file: string;
    percent: number;
    vestingType: VestingType;
};

task('mainnet-initialize-vesting', 'Initialize Vesting contract')
    .addParam('contract36m', 'Address of deployed vesting contract with 36 months vesting duration')
    .addParam('contract24m', 'Address of deployed vesting contract with 24 months vesting duration')
    .addParam('token', 'Address of current token contract')
    .addParam('start', 'Timestamp of the date, when vesting will start')
    .setAction(async (taskArgs, { ethers }) => {
        const [initializer] = await ethers.getSigners();
        const token = await ethers.getContractAt('ERC20', taskArgs.token);

        const totalSupply = await token.totalSupply();
        const arrrayBeneficiaries: BeneficiarType[] = [
            { file: 'pre-seed.json', percent: 5.5, vestingType: VestingType.Duration36m },
            { file: 'seed.json', percent: 12, vestingType: VestingType.Duration36m },
            { file: 'seed+.json', percent: 6, vestingType: VestingType.Duration24m },
            { file: 'developers.json', percent: 5, vestingType: VestingType.Duration36m },
            { file: 'foundingTeam.json', percent: 10, vestingType: VestingType.Duration36m },
            { file: 'advisors.json', percent: 6, vestingType: VestingType.Duration36m },
        ];

        let sum24m: bigint = 0n;
        let sum36m: bigint = 0n;
        let beneficiaries24m: BeneficiaryJson[] = [];
        let beneficiaries36m: BeneficiaryJson[] = [];
        for (const beneficiar of arrrayBeneficiaries) {
            const { beneficiaries, sum } = transformBeneficiar(beneficiar, totalSupply);
            if (beneficiar.vestingType === VestingType.Duration36m) {
                beneficiaries36m = beneficiaries36m.concat(beneficiaries);
                sum36m += sum;
            } else if (beneficiar.vestingType === VestingType.Duration24m) {
                beneficiaries24m = beneficiaries24m.concat(beneficiaries);
                sum24m += sum;
            } else {
                throw new Error('unidentified type of vesting');
            }
        }

        async function checkContractBalance(contractAddr: string, expectedBalance: bigint) {
            const balance = await token.balanceOf(contractAddr);
            if (expectedBalance !== balance) {
                throw new Error(contractAddr + ' expect balance ' + ethers.formatEther(expectedBalance) + ' but has ' + ethers.formatEther(balance));
            }
        }
        await checkContractBalance(taskArgs.contract36m, sum36m);
        await checkContractBalance(taskArgs.contract24m, sum24m);

        const start: bigint = BigInt(taskArgs.start);

        const vesting36m = await ethers.getContractAt('InsidersVesting', taskArgs.contract36m);
        const vestingLookupDuration = 12 * 30 * 24 * 60 * 60; // 12 months
        const vestingDuration36m = 36 * 30 * 24 * 60 * 60; // 36 months
        const vestingDuration24m = 24 * 30 * 24 * 60 * 60; // 24 months
        const tx1 = await vesting36m
            .connect(initializer)
            .initialize(taskArgs.token, beneficiaries36m, start, vestingLookupDuration, vestingDuration36m);
        console.log(tx1.hash, 'initialize vesting36m');
        await tx1.wait();

        const vesting24m = await ethers.getContractAt('InsidersVesting', taskArgs.contract24m);
        const tx2 = await vesting24m
            .connect(initializer)
            .initialize(taskArgs.token, beneficiaries24m, start, vestingLookupDuration, vestingDuration24m);
        console.log(tx2.hash, 'initialize vesting24m');
        await tx2.wait();

        console.log('Done');
    });

function transformBeneficiar(beneficiarType: BeneficiarType, totalSupply: bigint) {
    const parsed = JSON.parse(fs.readFileSync(beneficiarType.file, 'utf8')) as BeneficiaryJson[];
    const beneficiaries = parsed.map(b => {
        if (b.account < '0x0000000000000000000000000000000000000007') {
            throw new Error(`The beneficiary's address is defined as ${b.account}. You need to change it`);
        }
        return {
            account: b.account,
            tokenAmount: parseEther(b.tokenAmount.toString()),
        };
    });
    const sum = beneficiaries.reduce((accumulator, currentValue) => accumulator + currentValue.tokenAmount, 0n);
    const expectedSum = (totalSupply * BigInt(beneficiarType.percent * 100)) / 10000n;
    if (sum !== expectedSum) {
        throw new Error(
            beneficiarType.file +
                ` the amount ${formatEther(sum)} does not match the distribution. ${beneficiarType.percent}% of ${formatEther(totalSupply)} = ${formatEther(expectedSum)}`
        );
    }

    return { beneficiaries, sum };
}
