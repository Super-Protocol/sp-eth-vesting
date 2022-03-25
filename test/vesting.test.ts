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
        user4: SignerWithAddress,
        user5: SignerWithAddress;

    const lockup = 7948800;
    const vestingDuration = 36460800;

    let snapshot: any;

    before(async function () {
        [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();
        const SuperproTokenFactory: SuperproToken__factory = await ethers.getContractFactory('SuperproToken');
        superproToken = await SuperproTokenFactory.deploy(addDecimals(100000), 'Superpro Test Token', 'SPT');
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

    function addDecimals(amount: number) {
        return ethers.utils.parseEther(amount.toString());
    }

    async function initializeDefault() {
        const users = [user1.address, user2.address, user3.address];

        const tokenAmounts = [addDecimals(2000), addDecimals(3000), addDecimals(4000)];
        await superproToken.transfer(vesting.address, addDecimals(10000));
        await vesting.initialize(superproToken.address, users, tokenAmounts, 90);
    }

    it('should initialize correctly', async function () {
        await initializeDefault();

        const user1vesting = await vesting.getBeneficiaryInfo(user1.address);
        const user3vesting = await vesting.getBeneficiaryInfo(user3.address);
        expect(user1vesting.tokensPerSec).be.equal(user1vesting.tokensLocked.div(vestingDuration));
        expect(user1vesting.tokensLocked).be.equal(addDecimals(2000));
        expect(user3vesting.tokensPerSec).be.equal(user3vesting.tokensLocked.div(vestingDuration));
        expect(user3vesting.tokensLocked).be.equal(addDecimals(4000));

        expect(await vesting.whitelistTokensLimit()).be.equal(addDecimals(9000)); // 90%
        expect(await vesting.whitelistReserveTokensLimit()).be.equal(addDecimals(1000)); // 10%

        await expect(vesting.initialize(superproToken.address, [], [], 90)).be.revertedWith('Already initialized');
    });

    it('should revert initialize if sender is not the owner', async function () {
        await expect(vesting.connect(user1).initialize(superproToken.address, [], [], 90)).be.revertedWith('Not allowed to initialize');
    });

    it('should revert initialize when input params incorrect', async function () {
        await expect(vesting.initialize(superproToken.address, [user1.address, user2.address], [1000], 90)).be.revertedWith(
            'Users and tokenAmounts length mismatch'
        );
        await expect(vesting.initialize(superproToken.address, [], [], 90)).be.revertedWith('No users');
        await expect(vesting.initialize(superproToken.address, [user1.address], [1000], 90)).be.revertedWith('Zero token balance');

        await superproToken.transfer(vesting.address, 1000);
        await expect(vesting.initialize(superproToken.address, [user1.address], [1000], 90)).be.revertedWith('Exceeded tokens limit');

        await expect(vesting.initialize(superproToken.address, [ethers.constants.AddressZero], [900], 90)).be.revertedWith('Address is zero');
    });

    it('should add beneficiary to reserved whitelist after vesting started', async function () {
        await initializeDefault();

        await vesting.addBeneficiary(user4.address, addDecimals(1000));
        const record = await vesting.getBeneficiaryInfo(user4.address);
        expect(record.tokensLocked).be.equal(addDecimals(1000));
        expect(record.tokensClaimed).be.equal(0);
        expect(record.tokensPerSec).be.equal(record.tokensLocked.div(vestingDuration));
    });

    it('should allow beneficiary from reserve whitelist to claim', async function () {
        await initializeDefault();

        await vesting.addBeneficiary(user4.address, addDecimals(1000));

        await network.provider.send('evm_increaseTime', [lockup + 999]);
        await network.provider.send('evm_mine');

        const claim = await vesting.calculateClaim(user4.address);
        const record = await vesting.getBeneficiaryInfo(user4.address);
        expect(claim).be.eq(record.tokensPerSec.mul(1000));
    });

    it('should revert addBeneficiary if vesting has not started', async function () {
        await expect(vesting.addBeneficiary(user1.address, 1000)).be.revertedWith('Vesting has not started yet');
    });

    it('should revert addBeneficiary when input params incorrect', async function () {
        await initializeDefault();

        await expect(vesting.connect(user1).addBeneficiary(user1.address, 1000)).be.revertedWith('Not allowed to add beneficiary');
        await expect(vesting.addBeneficiary(ethers.constants.AddressZero, 1000)).be.revertedWith('Address is zero');
        await expect(vesting.addBeneficiary(user1.address, 1000)).be.revertedWith('Beneficiary is already in whitelist');
        await expect(vesting.addBeneficiary(user4.address, addDecimals(1001))).be.revertedWith('Exceeded tokens limit');
    });

    it('should forbid to claim if user has no locked tokens', async function () {
        await initializeDefault();
        await expect(vesting.claim(1)).be.revertedWith('Account is not in whitelist');
    });

    it('should forbid to claim during lock-up period', async function () {
        await initializeDefault();
        await expect(vesting.connect(user1).claim(1)).be.revertedWith('Cannot claim during 3 months lock-up period');
    });

    it('should forbid to claim if requested more than unlocked', async function () {
        await initializeDefault();
        const record = await vesting.getBeneficiaryInfo(user1.address);

        await network.provider.send('evm_increaseTime', [lockup + 998]);
        await network.provider.send('evm_mine');

        await expect(vesting.connect(user1).claim(record.tokensPerSec.mul(1000))).be.revertedWith('Requested more than unlocked');
    });

    it('should allow beneficiary to claim', async function () {
        await initializeDefault();
        const record = await vesting.getBeneficiaryInfo(user1.address);

        await network.provider.send('evm_increaseTime', [lockup + 999]);
        await network.provider.send('evm_mine');

        vesting.connect(user1).claim(record.tokensPerSec.mul(1000));
    });

    it('should allow beneficiary from main whitelist to sell share to another address', async function () {
        const seconds = Math.floor(new Date().getTime() / 1000);
        await network.provider.send('evm_setNextBlockTimestamp', [seconds]);
        await network.provider.send('evm_mine');

        await initializeDefault();
        const user1RecordOld = await vesting.getBeneficiaryInfo(user1.address);

        await network.provider.send('evm_setNextBlockTimestamp', [seconds + lockup + 99999]);
        await network.provider.send('evm_mine');

        const sellLocked = addDecimals(10);
        const sellUnlocked = addDecimals(1);

        await vesting.connect(user1).sellShare(user4.address, sellLocked, sellUnlocked);

        const user1Record = await vesting.getBeneficiaryInfo(user1.address);
        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        expect(user1Record.tokensLocked).be.equal(user1RecordOld.tokensLocked.sub(sellLocked.add(sellUnlocked)));
        expect(user1Record.tokensUnlockedSold).be.equal(sellUnlocked);
        expect(user4Record.tokensLocked).be.equal(sellLocked);
        expect(user4Record.tokensPending).be.equal(sellUnlocked);
        expect(user4Record.tokensClaimed).be.equal(0);
        expect(user4Record.startTime.toNumber()).be.equal(seconds + lockup + 100000);
    });

    it('should allow beneficiary from reserve whitelist to sell share to another address', async function () {
        const seconds = Math.floor(new Date().getTime() / 1000);
        await network.provider.send('evm_setNextBlockTimestamp', [seconds]);
        await network.provider.send('evm_mine');

        await initializeDefault();
        await vesting.addBeneficiary(user4.address, addDecimals(1000));
        const user4RecordOld = await vesting.getBeneficiaryInfo(user4.address);

        await network.provider.send('evm_setNextBlockTimestamp', [seconds + lockup + 99999]);
        await network.provider.send('evm_mine');

        const sellLocked = addDecimals(10);
        const sellUnlocked = addDecimals(1);

        await vesting.connect(user4).sellShare(user5.address, sellLocked, sellUnlocked);

        const user4Record = await vesting.getBeneficiaryInfo(user4.address);
        const user5Record = await vesting.getBeneficiaryInfo(user5.address);
        expect(user4Record.tokensLocked).be.equal(user4RecordOld.tokensLocked.sub(sellLocked.add(sellUnlocked)));
        expect(user4Record.tokensUnlockedSold).be.equal(sellUnlocked);
        expect(user5Record.tokensLocked).be.equal(sellLocked);
        expect(user5Record.tokensPending).be.equal(sellUnlocked);
        expect(user5Record.tokensClaimed).be.equal(0);
        expect(user5Record.startTime.toNumber()).be.equal(seconds + lockup + 100000);
    });

    it('should forbid sellShare when seller and buyer addresses are the same', async function () {
        await initializeDefault();
        const sellLocked = addDecimals(10);
        const sellUnlocked = addDecimals(1);
        await expect(vesting.connect(user1).sellShare(user1.address, sellLocked, sellUnlocked)).be.revertedWith('Cannot sell to the same address');
    });

    it('should forbid sellShare when buyer address is not presented', async function () {
        await initializeDefault();
        const sellLocked = addDecimals(10);
        const sellUnlocked = addDecimals(1);
        await expect(vesting.connect(user1).sellShare(user1.address, sellLocked, sellUnlocked)).be.revertedWith('Cannot sell to the same address');
    });

    it('should forbid sellShare if requested more assets than available', async function () {
        await initializeDefault();
        await network.provider.send('evm_increaseTime', [lockup]);
        await network.provider.send('evm_mine');

        let sellLocked = addDecimals(2001);
        const sellUnlocked = addDecimals(1);
        await expect(vesting.connect(user1).sellShare(user4.address, sellLocked, sellUnlocked)).be.revertedWith(
            'Requested more locked tokens than available'
        );
        sellLocked = addDecimals(10);
        await expect(vesting.connect(user1).sellShare(user4.address, sellLocked, sellUnlocked)).be.revertedWith(
            'Requested more unlocked tokens than available'
        );
    });
});
