import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { Vesting, Vesting__factory, SuperproToken, SuperproToken__factory } from '../typechain';

describe('Vesting', function () {
    let superproToken: SuperproToken;
    let vesting: Vesting;
    let owner: SignerWithAddress,
        user1: SignerWithAddress,
        user2: SignerWithAddress,
        user3: SignerWithAddress,
        user4: SignerWithAddress;

    const DURATION = 86745600;
    const LOCKUP_END = 1661990400;
    const FINISH = 1748736000;

    let snapshot: any;

    before(async function () {
        [owner, user1, user2, user3, user4] = await ethers.getSigners();
        const SuperproTokenFactory: SuperproToken__factory = await ethers.getContractFactory('SuperproToken');
        superproToken = await SuperproTokenFactory.deploy(parseEther(100000), 'SPT', 'Superpro Test Token');
        await superproToken.deployed();
        const Vesting: Vesting__factory = await ethers.getContractFactory('Vesting');

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
        await superproToken.transfer(vesting.address, parseEther(10000));
        await vesting.initialize(superproToken.address, users, tokenAmounts, parseEther(9000), parseEther(1000));
    }

    it('should initialize correctly', async function () {
        await initializeDefault();

        const user1vesting = await vesting.getBeneficiaryInfo(user1.address);
        const user3vesting = await vesting.getBeneficiaryInfo(user3.address);
        expect(user1vesting.tokensPerSec).be.equal(user1vesting.tokensLocked.div(DURATION));
        expect(user1vesting.tokensLocked).be.equal(parseEther(2000));
        expect(user3vesting.tokensPerSec).be.equal(user3vesting.tokensLocked.div(DURATION));
        expect(user3vesting.tokensLocked).be.equal(parseEther(4000));

        expect(await vesting.whitelistTokensLimit()).be.equal(parseEther(9000));
        expect(await vesting.whitelistReserveTokensLimit()).be.equal(parseEther(1000));

        await expect(vesting.initialize(superproToken.address, [], [], 90, 10)).be.revertedWith('Already initialized');
    });

    it('should revert initialize if sender is not the owner', async function () {
        await expect(vesting.connect(user1).initialize(superproToken.address, [], [], 90, 10)).be.revertedWith('Not allowed to initialize');
    });

    it('should revert initialize when input params incorrect', async function () {
        await expect(vesting.initialize(superproToken.address, [user1.address, user2.address], [900], 900, 100)).be.revertedWith(
            'Users and tokenAmounts length mismatch'
        );
        await expect(vesting.initialize(superproToken.address, [], [], 90, 10)).be.revertedWith('No users');
        await expect(vesting.initialize(superproToken.address, [user1.address], [900], 900, 100)).be.revertedWith('Insufficient token balance');

        await superproToken.transfer(vesting.address, 1000);
        await expect(vesting.initialize(superproToken.address, [user1.address], [901], 900, 100)).be.revertedWith('Exceeded tokens limit');

        await expect(vesting.initialize(superproToken.address, [ethers.constants.AddressZero], [900], 900, 100)).be.revertedWith('Address is zero');
    });

    it('should add beneficiary to whitelist after vesting started', async function () {
        await initializeDefault();

        await vesting.addBeneficiary(user4.address, parseEther(1000));
        const record = await vesting.getBeneficiaryInfo(user4.address);
        expect(record.tokensLocked).be.equal(parseEther(1000));
        expect(record.tokensClaimed).be.equal(0);
        expect(record.tokensPerSec).be.equal(record.tokensLocked.div(DURATION));
        expect(await vesting.whitelistReserveTokensLimit()).be.equal(await vesting.whitelistReserveTokensUsed());
    });

    it('should allow beneficiary from reserve to claim', async function () {
        await initializeDefault();

        await vesting.addBeneficiary(user4.address, parseEther(1000));

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 1000]);
        await network.provider.send('evm_mine');

        const claim = await vesting.calculateClaim(user4.address);
        const record = await vesting.getBeneficiaryInfo(user4.address);
        expect(claim).be.eq(record.tokensPerSec.mul(1000));
    });

    it('should calculate claim 0 before lock-up end', async function () {
        await initializeDefault();

        const claim = await vesting.calculateClaim(user1.address);
        expect(claim).be.eq(0);
    });

    it('should revert addBeneficiary if vesting has not started', async function () {
        await expect(vesting.addBeneficiary(user1.address, 1000)).be.revertedWith('Vesting has not started yet');
    });

    it('should revert addBeneficiary when input params incorrect', async function () {
        await initializeDefault();

        await expect(vesting.connect(user1).addBeneficiary(user1.address, 1000)).be.revertedWith('Not allowed to add beneficiary');
        await expect(vesting.addBeneficiary(ethers.constants.AddressZero, 1000)).be.revertedWith('Address is zero');
        await expect(vesting.addBeneficiary(user1.address, 1000)).be.revertedWith('Beneficiary is already in whitelist');
        await expect(vesting.addBeneficiary(user4.address, parseEther(1001))).be.revertedWith('Exceeded tokens limit');
    });

    it('should forbid to claim if user has no locked tokens', async function () {
        await initializeDefault();
        await expect(vesting.claim(owner.address, 1)).be.revertedWith('Account is not in whitelist');
    });

    it('should forbid to claim during lock-up period', async function () {
        await initializeDefault();
        await expect(vesting.connect(user1).claim(user1.address, 1)).be.revertedWith('Cannot claim during 3 months lock-up period');
    });

    it('should forbid to claim if requested more than unlocked', async function () {
        await initializeDefault();
        const record = await vesting.getBeneficiaryInfo(user1.address);

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 998]);;
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

    it('should not change claim amount when beneficiary paused vesting', async function () {
        await initializeDefault();

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 999]);
        await network.provider.send('evm_mine');

        await vesting.connect(user1).setPaused(true);
        const claimOld = await vesting.calculateClaim(user1.address);

        await network.provider.send('evm_increaseTime', [3600]);
        await network.provider.send('evm_mine');

        const claimNew = await vesting.calculateClaim(user1.address);
        expect(claimOld).be.equal(claimNew);
    });

    it('should update claim amount after beneficiary unpaused vesting', async function () {
        await initializeDefault();

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 999]);
        await network.provider.send('evm_mine');

        await vesting.connect(user1).setPaused(true);
        const claimOld = await vesting.calculateClaim(user1.address);

        await network.provider.send('evm_increaseTime', [999]);
        await network.provider.send('evm_mine');

        await vesting.connect(user1).setPaused(false);
        const claimNew = await vesting.calculateClaim(user1.address);
        const record = await vesting.getBeneficiaryInfo(user1.address);
        expect(record.pausedTime).be.equal(0);
        expect(claimNew.sub(claimOld)).be.equal(record.tokensPerSec.mul(1000));
        expect(claimNew).be.equal(record.tokensPerSec.mul(2000));
    });

    it('should allow to claim only stagedProfit', async function () {
        await initializeDefault();

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 999]);
        await network.provider.send('evm_mine');

        await vesting.connect(user1).setPaused(true);
        const claim1 = await vesting.calculateClaim(user1.address);

        await vesting.connect(user1).claim(user1.address, claim1);
        const claim2 = await vesting.calculateClaim(user1.address);
        const record1 = await vesting.getBeneficiaryInfo(user1.address);
        expect(claim2).be.equal(0);
        expect(record1.stagedProfit).be.equal(0);

        await network.provider.send('evm_increaseTime', [999]);
        await network.provider.send('evm_mine');

        await vesting.connect(user1).setPaused(false);
        const claim3 = await vesting.calculateClaim(user1.address);
        const record2 = await vesting.getBeneficiaryInfo(user1.address);
        
        expect(claim3).be.equal(record2.tokensPerSec.mul(1001));
    });

    it('should allow to sell share and claim the rest when vesting is paused', async function () {
        await initializeDefault();
        const share = parseEther(1000);

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + DURATION / 2 - 1]);
        await network.provider.send('evm_mine');

        await vesting.connect(user1).setPaused(true);
        const claim1 = await vesting.calculateClaim(user1.address);
        // expect(claim1).be.equal(share);

        await vesting.connect(user1).sellShare(user4.address, share);
        const claim2 = await vesting.calculateClaim(user1.address);
        expect(claim1).be.equal(claim2);
        const record1 = await vesting.getBeneficiaryInfo(user1.address);
        expect(record1.stagedProfit).be.equal(claim2);
        // expect(record1.tokensLocked).be.equal(0);
        await vesting.connect(user1).setPaused(false);

        await vesting.connect(user1).claim(user1.address, claim2);
        const record2 = await vesting.getBeneficiaryInfo(user1.address);
        const claim3 = await vesting.calculateClaim(user1.address);
        expect(claim3).be.equal(0);
        expect(record2.stagedProfit).be.equal(0);
        expect(record2.tokensLocked.toNumber()).be.closeTo(0, 50000000); // погрешность вычислений
    });

    it('should claim 3 times till the end', async function () {
        await initializeDefault();

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + DURATION / 3]);
        await network.provider.send('evm_mine');

        let claim = await vesting.calculateClaim(user2.address);
        expect(claim).be.closeTo(parseEther(1000), 10000000);
        await vesting.connect(user2).claim(user2.address, parseEther(1000));

        await network.provider.send('evm_increaseTime', [DURATION / 3]);
        await network.provider.send('evm_mine');

        claim = await vesting.calculateClaim(user2.address);
        expect(claim).be.closeTo(parseEther(1000), 10000000);
        await vesting.connect(user2).claim(user2.address, parseEther(1000));

        await network.provider.send('evm_increaseTime', [DURATION / 3]);
        await network.provider.send('evm_mine');

        claim = await vesting.calculateClaim(user2.address);
        expect(claim).be.closeTo(parseEther(1000), 10000000);
        await vesting.connect(user2).claim(user2.address, parseEther(1000));
    });

    it('should allow beneficiary to sell share after lock-up', async function () {
        await initializeDefault();
        const user1RecordOld = await vesting.getBeneficiaryInfo(user1.address);
        const timeshift = LOCKUP_END + 99999;
        await network.provider.send('evm_setNextBlockTimestamp', [timeshift]);
        await network.provider.send('evm_mine');

        const share = parseEther(1000);

        await vesting.connect(user1).sellShare(user4.address, share);

        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record.tokensLocked).be.equal(user1RecordOld.tokensLocked.sub(share).sub(user1Record.stagedProfit));
        expect(user1Record.tokensPerSec).be.equal(user1Record.tokensLocked.div(FINISH - timeshift - 1));
        expect(user4Record.tokensLocked).be.equal(share);
        expect(user4Record.tokensClaimed).be.equal(0);
        expect(user4Record.lastChange).be.equal(timeshift + 1);
        expect(user4Record.tokensPerSec).be.equal(user4Record.tokensLocked.div(FINISH - timeshift - 1));
    });

    it('should allow beneficiary to sell share while lock-up', async function () {
        await initializeDefault();
        const share = parseEther(1000);
        await vesting.connect(user1).sellShare(user4.address, share);

        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record.tokensLocked).be.equal(parseEther(1000));
        expect(user1Record.tokensPerSec).be.equal(user1Record.tokensLocked.div(DURATION));
        expect(user4Record.tokensLocked).be.equal(share);
        expect(user4Record.tokensClaimed).be.equal(0);
        expect(user4Record.lastChange).be.equal(LOCKUP_END);
        expect(user4Record.tokensPerSec).be.equal(share.div(DURATION));
    });

    it('should calculate claims correctly after selling share during lock-up', async function () {
        await initializeDefault();
        const share = parseEther(1000);
        await vesting.connect(user1).sellShare(user4.address, share);

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 99999]);
        await network.provider.send('evm_mine');

        const user1Claim = await vesting.calculateClaim(user1.address);
        const user4Claim = await vesting.calculateClaim(user4.address);
        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record.tokensPerSec.mul(99999)).be.equal(user1Claim);
        expect(user4Record.tokensPerSec.mul(99999)).be.equal(user4Claim);
    });

    it('should calculate claims correctly after selling share during vesting', async function () {
        await initializeDefault();
        const share = parseEther(1000);

        await network.provider.send('evm_setNextBlockTimestamp', [LOCKUP_END + 99999]);
        await network.provider.send('evm_mine');
        const user1ClaimOld = await vesting.calculateClaim(user1.address);
        const user1RecordOld = await vesting.getBeneficiaryInfo(user1.address);
        await vesting.connect(user1).sellShare(user4.address, share);

        const user1Claim = await vesting.calculateClaim(user1.address);
        const user4Claim = await vesting.calculateClaim(user4.address);

        expect(user1Claim).be.equal(user1ClaimOld.add(user1RecordOld.tokensPerSec));
        expect(user4Claim).be.equal(0);
    });

    it('should forbid sellShare when seller and buyer addresses are the same', async function () {
        await initializeDefault();
        const share = parseEther(10);
        await expect(vesting.connect(user1).sellShare(user1.address, share)).be.revertedWith('Cannot sell to the same address');
    });

    it('should forbid sellShare if requested more tokens than available', async function () {
        await initializeDefault();

        const share = parseEther(2001);
        await expect(vesting.connect(user1).sellShare(user4.address, share)).be.revertedWith('Requested more tokens than locked');
    });
});
