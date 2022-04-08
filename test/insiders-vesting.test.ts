import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { SuperproToken, InsidersVesting } from '../typechain';

describe('InsidersVesting', function () {
    let superproToken: SuperproToken;
    let vesting: InsidersVesting;
    let owner: SignerWithAddress, user1: SignerWithAddress, user2: SignerWithAddress, user3: SignerWithAddress, user4: SignerWithAddress;

    const START = 1654041600;
    const LOCKUP_END = START + 7776000;
    const DURATION = 86745600;
    const FINISH = LOCKUP_END + DURATION;
    const TOKENS_TOTAL = parseEther(400_000_000);
    let snapshot: any;

    before(async function () {
        [owner, user1, user2, user3, user4] = await ethers.getSigners();
        const SuperproTokenFactory = await ethers.getContractFactory('SuperproToken');
        superproToken = await SuperproTokenFactory.deploy(TOKENS_TOTAL, 'SPT', 'Superpro Test Token');
        await superproToken.deployed();
        const Vesting = await ethers.getContractFactory('InsidersVesting');

        vesting = await Vesting.deploy(owner.address);
        await vesting.deployed();
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
        return ethers.utils.parseEther(amount.toString());
    }

    async function initializeDefault() {
        const users = [user1.address, user2.address, user3.address];

        const tokenAmounts = [parseEther(2000), parseEther(3000), parseEther(4000)];
        await superproToken.transfer(vesting.address, TOKENS_TOTAL);
        await vesting.initialize(superproToken.address, users, tokenAmounts, START);
    }

    it('should initialize correctly', async function () {
        await initializeDefault();

        const user1vesting = await vesting.getBeneficiaryInfo(user1.address);
        const user3vesting = await vesting.getBeneficiaryInfo(user3.address);
        expect(user1vesting.tokensPerSec).be.equal(user1vesting.tokensLocked.div(DURATION));
        expect(user1vesting.tokensLocked).be.equal(parseEther(2000));
        expect(user3vesting.tokensPerSec).be.equal(user3vesting.tokensLocked.div(DURATION));
        expect(user3vesting.tokensLocked).be.equal(parseEther(4000));

        expect(await vesting.vestingStart()).be.equal(START);
        expect(await vesting.lockupEnd()).be.equal(LOCKUP_END);
        expect(await vesting.vestingFinish()).be.equal(LOCKUP_END + DURATION);

        await expect(vesting.initialize(superproToken.address, [], [], START)).be.revertedWith('Already initialized');
    });

    it('should be able to iterate over 200 beneficiaries', async function () {
        const accounts = new Array(500);
        const amounts = new Array(500);
        for (let i = 0; i < accounts.length; i++) {
            accounts[i] = user1.address;
            amounts[i] = parseEther(2000000);
        }
        await superproToken.transfer(vesting.address, TOKENS_TOTAL);
        await expect(vesting.initialize(superproToken.address, accounts, amounts, START)).not.be.reverted;
    });

    it('should revert initialize if sender is not the owner', async function () {
        await expect(vesting.connect(user1).initialize(superproToken.address, [], [], START)).be.revertedWith('Not allowed to initialize');
    });

    it('should revert getBeneficiaryInfo if account is not in whitelist', async function () {
        await expect(vesting.getBeneficiaryInfo(owner.address)).be.revertedWith('Account is not in whitelist');
    });

    it('should revert initialize when input params incorrect', async function () {
        await expect(vesting.initialize(superproToken.address, [user1.address, user2.address], [900], START)).be.revertedWith(
            'Users and tokenAmounts length mismatch'
        );
        await expect(vesting.initialize(superproToken.address, [], [], START)).be.revertedWith('No users');
        await superproToken.transfer(vesting.address, 1000);
        await expect(vesting.initialize(superproToken.address, [user1.address], [900], START)).be.revertedWith('Insufficient token balance');

        await superproToken.transfer(vesting.address, TOKENS_TOTAL.sub(1000));
        await expect(
            vesting.initialize(superproToken.address, [user1.address, user2.address], [parseEther(200000000), parseEther(200000001)], START)
        ).be.revertedWith('Exceeded tokens limit');

        await expect(vesting.initialize(superproToken.address, [ethers.constants.AddressZero], [900], START)).be.revertedWith('Address is zero');
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
        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END]);
        await network.provider.send('evm_mine');
        await expect(vesting.claim(owner.address, 1)).be.revertedWith('You are not in whitelist');
    });

    it('should forbid to claim if requested more than unlocked', async function () {
        await initializeDefault();
        const record = await vesting.getBeneficiaryInfo(user1.address);

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 998]);
        await network.provider.send('evm_mine');

        await expect(vesting.connect(user1).claim(user1.address, record.tokensPerSec.mul(1000))).be.revertedWith('Requested more than unlocked');
    });

    it('should allow beneficiary to claim for another address', async function () {
        await initializeDefault();
        const record = await vesting.getBeneficiaryInfo(user1.address);

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 999]);
        await network.provider.send('evm_mine');

        const claimAmount = record.tokensPerSec.mul(1000);
        await vesting.connect(user1).claim(user2.address, claimAmount);
        const record2 = await vesting.getBeneficiaryInfo(user1.address);

        expect(record2.tokensLocked).be.equal(record.tokensLocked.sub(claimAmount));
        expect(record2.tokensClaimed).be.equal(claimAmount);
        expect(await superproToken.balanceOf(user2.address)).be.equal(claimAmount);
    });

    it('should allow beneficiary to claim all after vesting finished', async function () {
        await initializeDefault();

        await network.provider.send('evm_setNextBlockTimestamp', [FINISH]);
        await network.provider.send('evm_mine');

        await vesting.connect(user1).claim(user1.address, parseEther(2000));
        const record = await vesting.getBeneficiaryInfo(user1.address);
        expect(record.tokensLocked).be.equal(0);
        expect(record.tokensClaimed).be.equal(parseEther(2000));
    });

    it('should claim 3 times till the end', async function () {
        await initializeDefault();
        const oneThirdDuration = DURATION / 3;
        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + oneThirdDuration]);
        await network.provider.send('evm_mine');

        await vesting.connect(user2).claim(user2.address, parseEther(1000));

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + oneThirdDuration * 2]);
        await network.provider.send('evm_mine');

        await vesting.connect(user2).claim(user2.address, parseEther(1000));

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + DURATION]);
        await network.provider.send('evm_mine');

        await vesting.connect(user2).claim(user2.address, parseEther(1000));
    });

    it('should transfer half of locked tokens to new beneficiary during lock-up', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        await vesting.connect(user1).transfer(user4.address, lockedTokens, 0);

        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record.tokensLocked).be.equal(lockedTokens);
        expect(user1Record.tokensPerSec).be.equal(user1Record.tokensLocked.div(DURATION));
        expect(user1Record.tokensLockedTransferred).be.equal(lockedTokens);
        expect(user4Record.tokensLocked).be.equal(lockedTokens);
        expect(user4Record.tokensClaimed).be.equal(0);
        expect(user4Record.lastVestingUpdate).be.equal(LOCKUP_END);
        expect(user4Record.tokensPerSec).be.equal(lockedTokens.div(DURATION));
    });

    it('should transfer half of locked tokens to existing beneficiary during lock-up', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        await vesting.connect(user1).transfer(user2.address, lockedTokens, 0);
        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user2Record = await vesting.getBeneficiaryInfo(user2.address);
        expect(user1Record.tokensLocked).be.equal(lockedTokens);
        expect(user1Record.tokensLockedTransferred).be.equal(lockedTokens);
        expect(user1Record.tokensPerSec).be.equal(user1Record.tokensLocked.div(DURATION));
        expect(user1Record.lastVestingUpdate).be.equal(LOCKUP_END);
        expect(user2Record.tokensLocked).be.equal(parseEther(4000));
        expect(user2Record.lastVestingUpdate).be.equal(LOCKUP_END);
        expect(user2Record.tokensPerSec).be.equal(user2Record.tokensLocked.div(DURATION));
    });

    it('should calculate claims correctly after transfer during lock-up', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        await vesting.connect(user1).transfer(user4.address, lockedTokens, 0);

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 10000]);
        await network.provider.send('evm_mine');

        const user1Claim = await vesting.calculateClaim(user1.address);
        const user4Claim = await vesting.calculateClaim(user4.address);
        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record.tokensPerSec.mul(10000)).be.equal(user1Claim);
        expect(user4Record.tokensPerSec.mul(10000)).be.equal(user4Claim);
    });

    it('should transfer locked and unlocked tokens to a new beneficiary after lock-up', async function () {
        await initializeDefault();
        const user1RecordOld = await vesting.getBeneficiaryInfo(user1.address);
        const timeshift = LOCKUP_END + 99999;
        await network.provider.send('evm_setNextBlockTimestamp', [timeshift]);
        await network.provider.send('evm_mine');

        const lockedTokens = parseEther(1000);
        const unlockedTokens = parseEther(1);

        await vesting.connect(user1).transfer(user4.address, lockedTokens, unlockedTokens);

        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record.tokensLocked).be.equal(user1RecordOld.tokensLocked.sub(lockedTokens).sub(user1Record.tokensUnlocked).sub(unlockedTokens));
        expect(user1Record.tokensLockedTransferred).be.equal(lockedTokens);
        expect(user1Record.tokensUnlockedTransferred).be.equal(unlockedTokens);
        expect(user1Record.tokensPerSec).be.equal(user1Record.tokensLocked.div(FINISH - timeshift - 1));
        expect(user4Record.tokensLocked).be.equal(lockedTokens);
        expect(user4Record.tokensUnlocked).be.equal(unlockedTokens);
        expect(user4Record.tokensClaimed).be.equal(0);
        expect(user4Record.lastVestingUpdate).be.equal(timeshift + 1);
        expect(user4Record.tokensPerSec).be.equal(user4Record.tokensLocked.div(FINISH - timeshift - 1));
    });

    it('should calculate claims correctly after transfer after lock-up', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        const unlockedTokens = parseEther(1);

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 99999]);
        await network.provider.send('evm_mine');
        const user1Record1 = await vesting.getBeneficiaryInfo(user1.address);
        await vesting.connect(user1).transfer(user4.address, lockedTokens, unlockedTokens);

        const user1Claim = await vesting.calculateClaim(user1.address);
        const user4Claim = await vesting.calculateClaim(user4.address);

        expect(user1Claim).be.equal(user1Record1.tokensPerSec.mul(100000).sub(unlockedTokens));
        expect(user4Claim).be.equal(unlockedTokens);
    });

    it('should transfer to existing beneficiary after lock-up', async function () {
        await initializeDefault();
        const lockedTokens = parseEther(1000);
        const unlockedTokens = parseEther(1);
        const timeshift = LOCKUP_END + 99999;

        await network.provider.send('evm_setNextBlockTimestamp', [timeshift]);
        await network.provider.send('evm_mine');
        const user1Record1 = await vesting.getBeneficiaryInfo(user1.address);
        const user2Record1 = await vesting.getBeneficiaryInfo(user2.address);
        const user1Claim1 = (await vesting.calculateClaim(user1.address)).add(user1Record1.tokensPerSec);
        const user2Claim1 = (await vesting.calculateClaim(user2.address)).add(user2Record1.tokensPerSec);

        await vesting.connect(user1).transfer(user2.address, lockedTokens, unlockedTokens);

        const user1Record2 = await vesting.getBeneficiaryInfo(user1.address);
        const user2Record2 = await vesting.getBeneficiaryInfo(user2.address);
        expect(user1Record2.tokensLocked).be.equal(user1Record1.tokensLocked.sub(lockedTokens).sub(unlockedTokens).sub(user1Record2.tokensUnlocked));
        expect(user1Record2.tokensUnlocked).be.equal(user1Claim1.sub(unlockedTokens));
        expect(user1Record2.tokensPerSec).be.equal(user1Record2.tokensLocked.div(FINISH - timeshift - 1));
        expect(user1Record2.tokensLockedTransferred).be.equal(lockedTokens);
        expect(user1Record2.tokensUnlockedTransferred).be.equal(unlockedTokens);
        expect(user1Record2.lastVestingUpdate).be.equal(timeshift + 1);
        expect(user2Record2.tokensUnlocked).be.equal(user2Claim1.add(unlockedTokens));
        expect(user2Record2.tokensLocked).be.equal(user2Record1.tokensLocked.add(lockedTokens).sub(user2Record2.tokensUnlocked.sub(unlockedTokens)));
        expect(user2Record2.lastVestingUpdate).be.equal(timeshift + 1);
        expect(user2Record2.tokensPerSec).be.equal(user2Record2.tokensLocked.div(FINISH - timeshift - 1));
    });

    it('should forbid transfer when seller and buyer addresses are the same', async function () {
        await initializeDefault();
        const share = parseEther(10);
        await expect(vesting.connect(user1).transfer(user1.address, share, share)).be.revertedWith('Cannot sell to the same address');
    });

    it('should forbid transfer if requested more tokens than available', async function () {
        await initializeDefault();
        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END]);
        await network.provider.send('evm_mine');
        const share = parseEther(2001);
        await expect(vesting.connect(user1).transfer(user4.address, share, 0)).be.revertedWith('Requested more tokens than locked');
    });

    it('should forbid transfer if requested more tokens than available', async function () {
        await initializeDefault();
        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 1000]);
        await network.provider.send('evm_mine');
        const lockedTokens = parseEther(200);
        const unlockedTokens = parseEther(1);
        await expect(vesting.connect(user1).transfer(user4.address, lockedTokens, unlockedTokens)).be.revertedWith(
            'Requested more tokens than unlocked'
        );
    });

    it('should transferAll to a new beneficiary during lock-up', async function () {
        await initializeDefault();
        const timeshift = START + 1000;
        await network.provider.send('evm_setNextBlockTimestamp', [timeshift]);
        await network.provider.send('evm_mine');

        await vesting.connect(user1).transferAll(user4.address);
        const user1Info = await vesting.getBeneficiaryInfo(user1.address);
        const user4Info = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Info.tokensLocked).be.equal(0);
        expect(user1Info.tokensUnlocked).be.equal(0);
        expect(user1Info.tokensLockedTransferred).be.equal(user4Info.tokensLocked);
        expect(user1Info.tokensUnlockedTransferred).be.equal(user4Info.tokensUnlocked);
        expect(user1Info.tokensPerSec).be.equal(0);
        expect(user1Info.lastVestingUpdate).be.equal(LOCKUP_END);

        expect(user4Info.startTime).be.equal(timeshift + 1);
        expect(user4Info.tokensLocked).be.equal(parseEther(2000));
        expect(user4Info.tokensUnlocked).be.equal(0);
        expect(user4Info.tokensLockedTransferred).be.equal(0);
        expect(user4Info.tokensUnlockedTransferred).be.equal(0);
        expect(user4Info.tokensPerSec).be.equal(user4Info.tokensLocked.div(DURATION));
        expect(user4Info.lastVestingUpdate).be.equal(LOCKUP_END);
    });

    it('should transferAll to an existing beneficiary during lock-up', async function () {
        await initializeDefault();

        const user1InfoOld = await vesting.getBeneficiaryInfo(user1.address);
        const user2InfoOld = await vesting.getBeneficiaryInfo(user2.address);
        await vesting.connect(user1).transferAll(user2.address);
        const user2Info = await vesting.getBeneficiaryInfo(user2.address);
        expect(user2Info.startTime).be.equal(START);
        expect(user2Info.tokensLocked).be.equal(user2InfoOld.tokensLocked.add(user1InfoOld.tokensLocked));
        expect(user2Info.tokensUnlocked).be.equal(0);
        expect(user2Info.tokensPerSec).be.equal(user2Info.tokensLocked.div(DURATION));
        expect(user2Info.lastVestingUpdate).be.equal(LOCKUP_END);
    });

    it('should transferAll to a new beneficiary after lock-up', async function () {
        await initializeDefault();
        const timeshift = LOCKUP_END + 99999;
        await network.provider.send('evm_setNextBlockTimestamp', [timeshift]);
        await network.provider.send('evm_mine');

        const user1Info = await vesting.getBeneficiaryInfo(user1.address);
        await vesting.connect(user1).transferAll(user4.address);
        const user4Info = await vesting.getBeneficiaryInfo(user4.address);
        const unlockedTokens = user1Info.tokensPerSec.mul(100000);
        expect(user4Info.startTime).be.equal(timeshift + 1);
        expect(user4Info.tokensLocked).be.equal(user1Info.tokensLocked.sub(unlockedTokens));
        expect(user4Info.tokensUnlocked).be.equal(unlockedTokens);
        expect(user4Info.tokensLockedTransferred).be.equal(0);
        expect(user4Info.tokensUnlockedTransferred).be.equal(0);
        expect(user4Info.tokensPerSec).be.equal(user4Info.tokensLocked.div(FINISH - timeshift - 1));
        expect(user4Info.lastVestingUpdate).be.equal(timeshift + 1);
    });

    it('should transferAll to an existing beneficiary after lock-up', async function () {
        await initializeDefault();
        const timeshift = LOCKUP_END + 99999;
        await network.provider.send('evm_setNextBlockTimestamp', [timeshift]);
        await network.provider.send('evm_mine');

        const user1InfoOld = await vesting.getBeneficiaryInfo(user1.address);
        const user2InfoOld = await vesting.getBeneficiaryInfo(user2.address);
        await vesting.connect(user1).transferAll(user2.address);
        const user2Info = await vesting.getBeneficiaryInfo(user2.address);
        const user1Unlocked = user1InfoOld.tokensPerSec.mul(100000);
        const user1Locked = user1InfoOld.tokensLocked.sub(user1Unlocked);
        const user2Unlocked = user2InfoOld.tokensPerSec.mul(100000);
        const user2Locked = user2InfoOld.tokensLocked.sub(user2Unlocked);
        expect(user2Info.startTime).be.equal(START);
        expect(user2Info.tokensLocked).be.equal(user2Locked.add(user1Locked));
        expect(user2Info.tokensUnlocked).be.equal(user2Unlocked.add(user1Unlocked));
        expect(user2Info.tokensLockedTransferred).be.equal(0);
        expect(user2Info.tokensUnlockedTransferred).be.equal(0);
        expect(user2Info.tokensPerSec).be.equal(user2Info.tokensLocked.div(FINISH - timeshift - 1));
        expect(user2Info.lastVestingUpdate).be.equal(timeshift + 1);
    });
});
