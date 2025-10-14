import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { SuperproToken, InsidersVesting } from '../typechain';
import { Wallet } from 'ethers';
import crypto from 'crypto';

interface BeneficiaryInit {
    account: string;
    tokenAmount: bigint;
}

describe('InsidersVesting', function () {
    let superproToken: SuperproToken;
    let superproTokenAddress: string;
    let vesting: InsidersVesting;
    let vestingAddress: string;
    let owner: SignerWithAddress, user1: SignerWithAddress, user2: SignerWithAddress, user3: SignerWithAddress, user4: SignerWithAddress;

    const oneDay = 86400;
    const START = BigInt(Math.floor(Date.now() / 1000) + oneDay);
    const LOCKUP_END = START + 7776000n;
    const DURATION = 86745600n;
    const FINISH = LOCKUP_END + DURATION;
    const TOKENS_TOTAL = parseEther(400_000_000);
    let snapshot: any;

    before(async function () {
        [owner, user1, user2, user3, user4] = await ethers.getSigners();
        const SuperproTokenFactory = await ethers.getContractFactory('SuperproToken');
        superproToken = await SuperproTokenFactory.deploy(TOKENS_TOTAL, 'SPT', 'Superpro Test Token');
        await superproToken.waitForDeployment();
        superproTokenAddress = await superproToken.getAddress();

        const Vesting = await ethers.getContractFactory('InsidersVesting');
        vesting = await Vesting.deploy(owner.address);
        await vesting.waitForDeployment();
        vestingAddress = await vesting.getAddress();

        snapshot = await network.provider.request({
            method: 'evm_snapshot',
            params: [],
        });
    });

    afterEach(async function () {
        await network.provider.request({
            method: 'evm_revert',
            params: [snapshot],
        });

        snapshot = await network.provider.request({
            method: 'evm_snapshot',
            params: [],
        });
    });

    function parseEther(amount: number) {
        return ethers.parseEther(amount.toString());
    }

    async function initializeDefault() {
        const remaining = TOKENS_TOTAL - parseEther(2000) - parseEther(3000);
        const beneficiaries: BeneficiaryInit[] = [
            { account: user1.address, tokenAmount: parseEther(2000) },
            { account: user2.address, tokenAmount: parseEther(3000) },
            { account: user3.address, tokenAmount: remaining },
        ];
        await superproToken.transfer(vestingAddress, TOKENS_TOTAL);
        await vesting.initialize(superproTokenAddress, beneficiaries, START);
    }

    async function skipSecondsTo(ts: number | bigint) {
        await network.provider.send('evm_setNextBlockTimestamp', [Number(ts)]);
        await network.provider.send('evm_mine');
    }

    it('should be able to iterate over 200 beneficiaries', async function () {
        const beneficiaries: BeneficiaryInit[] = new Array(200); // 400 also passes
        const genRandomAddress = async () => {
            const id = crypto.randomBytes(32).toString('hex');
            const w = new Wallet('0x' + id);
            return w.getAddress();
        };
        for (let i = 0; i < beneficiaries.length; i++) {
            beneficiaries[i] = {
                account: await genRandomAddress(),
                tokenAmount: parseEther(2000000),
            };
        }

        await superproToken.transfer(vestingAddress, TOKENS_TOTAL);
        await expect(vesting.initialize(superproTokenAddress, beneficiaries, START)).not.be.reverted;
    });

    it('should reject zero beneficiary address', async function () {
        const beneficiaries: BeneficiaryInit[] = [
            {
                account: '0x0000000000000000000000000000000000000000',
                tokenAmount: TOKENS_TOTAL,
            },
        ];

        await superproToken.transfer(vestingAddress, TOKENS_TOTAL);
        await expect(vesting.initialize(superproTokenAddress, beneficiaries, START)).be.revertedWith('Beneficiary address must be valid');
    });

    it('should reject duplicate beneficiary', async function () {
        const beneficiaries: BeneficiaryInit[] = [
            {
                account: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
                tokenAmount: parseEther(2000000),
            },
            {
                account: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
                tokenAmount: TOKENS_TOTAL - parseEther(2000000),
            },
        ];

        await superproToken.transfer(vestingAddress, TOKENS_TOTAL);
        await expect(vesting.initialize(superproTokenAddress, beneficiaries, START)).be.revertedWith('Duplicate beneficiary');
    });

    it('should initialize correctly', async function () {
        await initializeDefault();

        const user1vesting = await vesting.getBeneficiaryInfo(user1.address);
        const user2vesting = await vesting.getBeneficiaryInfo(user2.address);
        expect(user1vesting.tokensPerSec).be.equal(user1vesting.tokensLocked / DURATION);
        expect(user1vesting.tokensLocked).be.equal(parseEther(2000));
        expect(user2vesting.tokensPerSec).be.equal(user2vesting.tokensLocked / DURATION);
        expect(user2vesting.tokensLocked).be.equal(parseEther(3000));

        expect(await vesting.vestingStart()).be.equal(START);
        expect(await vesting.lockupEnd()).be.equal(LOCKUP_END);
        expect(await vesting.vestingFinish()).be.equal(LOCKUP_END + DURATION);

        await expect(vesting.initialize(superproTokenAddress, [], START)).be.revertedWith('Already initialized');
    });

    it('should revert initialize if sender is not the owner', async function () {
        await expect(vesting.connect(user1).initialize(superproTokenAddress, [], START)).be.revertedWith('Not allowed to initialize');
    });

    it('should revert getBeneficiaryInfo if account is not in whitelist', async function () {
        await expect(vesting.getBeneficiaryInfo(owner.address)).be.revertedWith('Account is not in whitelist');
    });

    it('should revert initialize when input params incorrect', async function () {
        const timeInPast = Math.floor(Date.now() / 1000) - 10;
        await expect(vesting.initialize(superproTokenAddress, [], START)).be.revertedWith('No users');
        let beneficiaries: BeneficiaryInit[] = [{ account: user1.address, tokenAmount: BigInt(1000) }];
        await expect(vesting.initialize(superproTokenAddress, beneficiaries, START)).be.revertedWith('Zero token balance');

        await superproToken.transfer(vestingAddress, TOKENS_TOTAL);
        await expect(vesting.initialize(superproTokenAddress, beneficiaries, timeInPast)).be.revertedWith('Start timestamp is in the past');

        beneficiaries = [
            { account: user1.address, tokenAmount: parseEther(200000000) },
            { account: user2.address, tokenAmount: parseEther(199999999) },
        ];
        await expect(vesting.initialize(superproTokenAddress, beneficiaries, START)).be.revertedWith('Not all tokens are distributed');
        beneficiaries = [
            { account: user1.address, tokenAmount: parseEther(200000000) },
            { account: user2.address, tokenAmount: parseEther(200000001) },
        ];
        await expect(vesting.initialize(superproTokenAddress, beneficiaries, START)).be.revertedWith('Tokens sum is greater than balance');
    });

    it('should calculate claim 0 before lock-up end', async function () {
        await initializeDefault();

        const claim = await vesting.calculateClaim(user1.address);
        expect(claim).be.eq(0);
    });

    it('should forbid to claim during lock-up period', async function () {
        await initializeDefault();
        await expect(vesting.connect(user1).claim(user1.address, 1)).be.revertedWith('Cannot claim during 3 months lock-up period');
    });

    it('should forbid to claim if user is not in whitelist', async function () {
        await initializeDefault();
        await skipSecondsTo(LOCKUP_END);
        await expect(vesting.claim(owner.address, 1)).be.revertedWith('You are not in whitelist');
    });

    it('should forbid to claim if requested more than unlocked', async function () {
        await initializeDefault();
        const record = await vesting.getBeneficiaryInfo(user1.address);

        await skipSecondsTo(LOCKUP_END + 999n);
        await vesting.connect(user1).claim(user1.address, record.tokensPerSec * 1000n);

        await skipSecondsTo(LOCKUP_END + 1998n);

        await expect(vesting.connect(user1).claim(user1.address, record.tokensPerSec * 1000n)).be.revertedWith('Requested more than unlocked');
    });

    it('should allow beneficiary to claim for another address', async function () {
        await initializeDefault();
        const record = await vesting.getBeneficiaryInfo(user1.address);

        await skipSecondsTo(LOCKUP_END + 999n);

        const claimAmount = record.tokensPerSec * 1000n;
        await vesting.connect(user1).claim(user2.address, claimAmount);
        const record2 = await vesting.getBeneficiaryInfo(user1.address);

        expect(record2.tokensLocked).be.equal(record.tokensLocked - claimAmount);
        expect(record2.tokensClaimed).be.equal(claimAmount);
        expect(await superproToken.balanceOf(user2.address)).be.equal(claimAmount);
    });

    it('should emit TokensClaimed event on claim', async function () {
        await initializeDefault();

        await skipSecondsTo(LOCKUP_END + 999n);

        const claimAmount = (await vesting.getBeneficiaryInfo(user1.address)).tokensPerSec * 1000n;

        const currentBlockNumber = await ethers.provider.getBlockNumber();
        const tx = await vesting.connect(user1).claim(user2.address, claimAmount);
        await tx.wait();
        const events = await vesting.queryFilter(vesting.filters.TokensClaimed, currentBlockNumber + 1);
        const event = events[0];

        /* eslint-disable no-unused-expressions */
        expect(event, 'TokensClaimed event wasn`t emitted').be.ok;
        expect(event.args.from).eq(user1.address);
        expect(event.args.to).eq(user2.address);
        expect(event.args.amount).eq(claimAmount);
    });

    it('should allow beneficiary to claim all after vesting finished', async function () {
        await initializeDefault();

        await skipSecondsTo(FINISH);

        await vesting.connect(user1).claim(user1.address, parseEther(2000));
        const record = await vesting.getBeneficiaryInfo(user1.address);
        expect(record.tokensLocked).be.equal(0);
        expect(record.tokensClaimed).be.equal(parseEther(2000));
    });

    it('should claim 3 times till the end', async function () {
        await initializeDefault();
        const oneThirdDuration = DURATION / 3n;
        await skipSecondsTo(LOCKUP_END + oneThirdDuration);

        await vesting.connect(user2).claim(user2.address, parseEther(1000));

        await skipSecondsTo(LOCKUP_END + oneThirdDuration * 2n);

        await vesting.connect(user2).claim(user2.address, parseEther(1000));

        await skipSecondsTo(LOCKUP_END + DURATION);

        await vesting.connect(user2).claim(user2.address, parseEther(1000));
        expect(await vesting.connect(user2).calculateClaim(user2.address)).be.equal(0);
    });

    it('should emit TokensTransferred event on transfer', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        const currentBlockNumber = await ethers.provider.getBlockNumber();
        const tx = await vesting.connect(user1).transfer(user4.address, lockedTokens, 0);
        await tx.wait();
        const events = await vesting.queryFilter(vesting.filters.TokensTransferred, currentBlockNumber + 1);
        const event = events[0];
        /* eslint-disable no-unused-expressions */
        expect(event, 'TokensTransferred event wasn`t emitted').be.ok;
        expect(event.args.from).eq(user1.address);
        expect(event.args.to).eq(user4.address);
        expect(event.args.amountLocked).eq(lockedTokens);
        expect(event.args.amountUnlocked).eq(0);
    });

    it('should transfer half of locked tokens to new beneficiary during lock-up', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        await vesting.connect(user1).transfer(user4.address, lockedTokens, 0);

        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record.tokensLocked).be.equal(lockedTokens);
        expect(user1Record.tokensPerSec).be.equal(user1Record.tokensLocked / DURATION);
        expect(user4Record.tokensLocked).be.equal(lockedTokens);
        expect(user4Record.tokensClaimed).be.equal(0);
        expect(user4Record.lastVestingUpdate).be.equal(LOCKUP_END);
        expect(user4Record.tokensPerSec).be.equal(lockedTokens / DURATION);
    });

    it('should transfer half of locked tokens to existing beneficiary during lock-up', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        await vesting.connect(user1).transfer(user2.address, lockedTokens, 0);
        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user2Record = await vesting.getBeneficiaryInfo(user2.address);
        expect(user1Record.tokensLocked).be.equal(lockedTokens);
        expect(user1Record.tokensPerSec).be.equal(user1Record.tokensLocked / DURATION);
        expect(user1Record.lastVestingUpdate).be.equal(LOCKUP_END);
        expect(user2Record.tokensLocked).be.equal(parseEther(4000));
        expect(user2Record.lastVestingUpdate).be.equal(LOCKUP_END);
        expect(user2Record.tokensPerSec).be.equal(user2Record.tokensLocked / DURATION);
    });

    it('should calculate claims correctly after transfer during lock-up', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        await vesting.connect(user1).transfer(user4.address, lockedTokens, 0);

        await skipSecondsTo(LOCKUP_END + 10000n);

        const user1Claim = await vesting.calculateClaim(user1.address);
        const user4Claim = await vesting.calculateClaim(user4.address);
        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record.tokensPerSec * 10000n).be.equal(user1Claim);
        expect(user4Record.tokensPerSec * 10000n).be.equal(user4Claim);
    });

    it('should transfer locked and unlocked tokens to a new beneficiary after lock-up', async function () {
        await initializeDefault();
        const user1RecordOld = await vesting.getBeneficiaryInfo(user1.address);
        const timeshift = LOCKUP_END + 99999n;
        await skipSecondsTo(timeshift);

        const lockedTokens = parseEther(1000);
        const unlockedTokens = parseEther(1);

        await vesting.connect(user1).transfer(user4.address, lockedTokens, unlockedTokens);

        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record.tokensLocked).be.equal(user1RecordOld.tokensLocked - lockedTokens - user1Record.tokensUnlocked - unlockedTokens);
        expect(user1Record.tokensPerSec).be.equal(user1Record.tokensLocked / (FINISH - timeshift - 1n));
        expect(user4Record.tokensLocked).be.equal(lockedTokens);
        expect(user4Record.tokensUnlocked).be.equal(unlockedTokens);
        expect(user4Record.tokensClaimed).be.equal(0);
        expect(user4Record.lastVestingUpdate).be.equal(timeshift + 1n);
        expect(user4Record.tokensPerSec).be.equal(user4Record.tokensLocked / (FINISH - timeshift - 1n));
    });

    it('should calculate claims correctly after transfer after lock-up', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        const unlockedTokens = parseEther(1);

        await skipSecondsTo(LOCKUP_END + 99999n);
        const user1Record1 = await vesting.getBeneficiaryInfo(user1.address);
        await vesting.connect(user1).transfer(user4.address, lockedTokens, unlockedTokens);

        const user1Claim = await vesting.calculateClaim(user1.address);
        const user4Claim = await vesting.calculateClaim(user4.address);

        expect(user1Claim).be.equal(user1Record1.tokensPerSec * 100000n - unlockedTokens);
        expect(user4Claim).be.equal(unlockedTokens);
    });

    it('should transfer to existing beneficiary after lock-up', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        const unlockedTokens = parseEther(1);
        const timeshift = LOCKUP_END + 99999n;

        await skipSecondsTo(timeshift);
        const user1Record1 = await vesting.getBeneficiaryInfo(user1.address);
        const user2Record1 = await vesting.getBeneficiaryInfo(user2.address);
        const user1Claim1 = (await vesting.calculateClaim(user1.address)) + user1Record1.tokensPerSec;
        const user2Claim1 = (await vesting.calculateClaim(user2.address)) + user2Record1.tokensPerSec;

        await vesting.connect(user1).transfer(user2.address, lockedTokens, unlockedTokens);

        const user1Record2 = await vesting.getBeneficiaryInfo(user1.address);
        const user2Record2 = await vesting.getBeneficiaryInfo(user2.address);
        expect(user1Record2.tokensLocked).be.equal(user1Record1.tokensLocked - lockedTokens - unlockedTokens - user1Record2.tokensUnlocked);
        expect(user1Record2.tokensUnlocked).be.equal(user1Claim1 - unlockedTokens);
        expect(user1Record2.tokensPerSec).be.equal(user1Record2.tokensLocked / (FINISH - timeshift - 1n));
        expect(user1Record2.lastVestingUpdate).be.equal(timeshift + 1n);
        expect(user2Record2.tokensUnlocked).be.equal(user2Claim1 + unlockedTokens);
        expect(user2Record2.tokensLocked).be.equal(user2Record1.tokensLocked + lockedTokens - (user2Record2.tokensUnlocked - unlockedTokens));
        expect(user2Record2.lastVestingUpdate).be.equal(timeshift + 1n);
        expect(user2Record2.tokensPerSec).be.equal(user2Record2.tokensLocked / (FINISH - timeshift - 1n));
    });

    it('should transfer unlocked to existing beneficiary after finish', async function () {
        await initializeDefault();
        const halfTokens = parseEther(1000);
        const oneToken = parseEther(1);
        const timeshift = LOCKUP_END + 99999n;

        await skipSecondsTo(timeshift);
        const user1Record1 = await vesting.getBeneficiaryInfo(user1.address);
        const user2Record1 = await vesting.getBeneficiaryInfo(user2.address);

        await vesting.connect(user1).transfer(user2.address, halfTokens, oneToken);

        await skipSecondsTo(FINISH);

        await expect(vesting.connect(user1).transfer(user2.address, 0, halfTokens)).be.revertedWith('Requested more tokens than unlocked');
        await vesting.connect(user1).transfer(user2.address, 0, parseEther(999));

        const user1Record2 = await vesting.getBeneficiaryInfo(user1.address);
        const user2Record2 = await vesting.getBeneficiaryInfo(user2.address);
        expect(user1Record2.tokensLocked).be.equal(0);
        expect(user1Record2.tokensUnlocked).be.equal(0);
        expect(user1Record2.tokensPerSec).be.equal(0);
        expect(user1Record2.lastVestingUpdate).be.equal(FINISH + 2n);
        expect(user2Record2.tokensLocked).be.equal(0);
        expect(user2Record2.tokensUnlocked).be.equal(user2Record1.tokensLocked + user1Record1.tokensLocked);
        expect(user2Record2.lastVestingUpdate).be.equal(FINISH + 2n);
        expect(user2Record2.tokensPerSec).be.equal(0);
        await vesting.connect(user2).claim(user2.address, parseEther(5000));
    });

    it('should transfer unlocked to a new beneficiary after finish', async function () {
        await initializeDefault();
        const halfTokens = parseEther(1000);

        await skipSecondsTo(FINISH);

        await expect(vesting.connect(user1).transfer(user4.address, 0, parseEther(2000) + 1n)).be.revertedWith('Requested more tokens than unlocked');
        await vesting.connect(user1).transfer(user4.address, 0, halfTokens);

        const user1Record2 = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record2 = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record2.tokensUnlocked).be.equal(halfTokens);
        expect(user4Record2.tokensLocked).be.equal(0);
        expect(user4Record2.tokensUnlocked).be.equal(halfTokens);
        expect(user4Record2.startTime).be.equal(FINISH + 2n);
        expect(user4Record2.lastVestingUpdate).be.equal(FINISH + 2n);
        expect(user4Record2.tokensPerSec).be.equal(0);
        await vesting.connect(user4).claim(user4.address, parseEther(1000));
    });

    it('should forbid transfer when seller and buyer addresses are the same', async function () {
        await initializeDefault();
        const share = parseEther(10);
        await expect(vesting.connect(user1).transfer(user1.address, share, 0)).be.revertedWith('Cannot transfer to the same address');
    });

    it('should forbid transfer if requested more tokens than available', async function () {
        await initializeDefault();
        await skipSecondsTo(LOCKUP_END);
        const share = parseEther(2001);
        await expect(vesting.connect(user1).transfer(user4.address, share, 0)).be.revertedWith('Requested more tokens than locked');
    });

    it('should forbid transfer if requested more tokens than available', async function () {
        await initializeDefault();
        await skipSecondsTo(LOCKUP_END + 1000n);
        const lockedTokens = parseEther(200);
        const unlockedTokens = parseEther(1);
        await expect(vesting.connect(user1).transfer(user4.address, lockedTokens, unlockedTokens)).be.revertedWith(
            'Requested more tokens than unlocked'
        );
    });

    it('should transferAll to a new beneficiary during lock-up', async function () {
        await initializeDefault();
        const timeshift = START + 1000n;
        await skipSecondsTo(timeshift);

        await vesting.connect(user1).transferAll(user4.address);
        const user1Info = await vesting.getBeneficiaryInfo(user1.address);
        const user4Info = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Info.tokensLocked).be.equal(0);
        expect(user1Info.tokensUnlocked).be.equal(0);
        expect(user1Info.tokensPerSec).be.equal(0);
        expect(user1Info.lastVestingUpdate).be.equal(LOCKUP_END);

        expect(user4Info.startTime).be.equal(timeshift + 1n);
        expect(user4Info.tokensLocked).be.equal(parseEther(2000));
        expect(user4Info.tokensUnlocked).be.equal(0);
        expect(user4Info.tokensPerSec).be.equal(user4Info.tokensLocked / DURATION);
        expect(user4Info.lastVestingUpdate).be.equal(LOCKUP_END);
    });

    it('should transferAll to an existing beneficiary during lock-up', async function () {
        await initializeDefault();

        const user1InfoOld = await vesting.getBeneficiaryInfo(user1.address);
        const user2InfoOld = await vesting.getBeneficiaryInfo(user2.address);
        await vesting.connect(user1).transferAll(user2.address);
        const user2Info = await vesting.getBeneficiaryInfo(user2.address);
        expect(user2Info.startTime).be.equal(START);
        expect(user2Info.tokensLocked).be.equal(user2InfoOld.tokensLocked + user1InfoOld.tokensLocked);
        expect(user2Info.tokensUnlocked).be.equal(0);
        expect(user2Info.tokensPerSec).be.equal(user2Info.tokensLocked / DURATION);
        expect(user2Info.lastVestingUpdate).be.equal(LOCKUP_END);
    });

    it('should transferAll to a new beneficiary after lock-up', async function () {
        await initializeDefault();
        const timeshift = LOCKUP_END + 99999n;
        await skipSecondsTo(timeshift);

        const user1Info = await vesting.getBeneficiaryInfo(user1.address);
        await vesting.connect(user1).transferAll(user4.address);
        const user4Info = await vesting.getBeneficiaryInfo(user4.address);
        const unlockedTokens = user1Info.tokensPerSec * 100000n;
        expect(user4Info.startTime).be.equal(timeshift + 1n);
        expect(user4Info.tokensLocked).be.equal(user1Info.tokensLocked - unlockedTokens);
        expect(user4Info.tokensUnlocked).be.equal(unlockedTokens);
        expect(user4Info.tokensPerSec).be.equal(user4Info.tokensLocked / (FINISH - timeshift - 1n));
        expect(user4Info.lastVestingUpdate).be.equal(timeshift + 1n);
    });

    it('should transferAll to an existing beneficiary after lock-up', async function () {
        await initializeDefault();
        const timeshift = LOCKUP_END + 99999n;
        await skipSecondsTo(timeshift);

        const user1InfoOld = await vesting.getBeneficiaryInfo(user1.address);
        const user2InfoOld = await vesting.getBeneficiaryInfo(user2.address);
        await vesting.connect(user1).transferAll(user2.address);
        const user2Info = await vesting.getBeneficiaryInfo(user2.address);
        const user1Unlocked = user1InfoOld.tokensPerSec * 100000n;
        const user1Locked = user1InfoOld.tokensLocked - user1Unlocked;
        const user2Unlocked = user2InfoOld.tokensPerSec * 100000n;
        const user2Locked = user2InfoOld.tokensLocked - user2Unlocked;
        expect(user2Info.startTime).be.equal(START);
        expect(user2Info.tokensLocked).be.equal(user2Locked + user1Locked);
        expect(user2Info.tokensUnlocked).be.equal(user2Unlocked + user1Unlocked);
        expect(user2Info.tokensPerSec).be.equal(user2Info.tokensLocked / (FINISH - timeshift - 1n));
        expect(user2Info.lastVestingUpdate).be.equal(timeshift + 1n);
    });
});
