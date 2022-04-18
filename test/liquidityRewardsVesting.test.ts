import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { SuperproToken, LiquidityRewardsVesting } from '../typechain';

describe('LiquidityRewardsVesting', function () {
    let superproToken: SuperproToken;
    let vesting: LiquidityRewardsVesting;
    let deployer: SignerWithAddress, admin: SignerWithAddress, impostor: SignerWithAddress, dao: SignerWithAddress;

    const ONE_DAY = 86400;
    const VESTING_START = Math.floor(Date.now() / 1000) + ONE_DAY;
    const VESTING_DURATION = 71107200;
    const VESTING_FINISH = VESTING_START + VESTING_DURATION;
    const TOTAL_TOKENS = parseEther(90_000_000);

    let snapshot: any;

    before(async function () {
        [deployer, admin, impostor, dao] = await ethers.getSigners();
        const superproTokenFactory = await ethers.getContractFactory('SuperproToken');
        superproToken = await superproTokenFactory.deploy(TOTAL_TOKENS, 'SPT', 'Superpro Test Token');
        await superproToken.deployed();
        const vestingFactory = await ethers.getContractFactory('LiquidityRewardsVesting');

        vesting = await vestingFactory.deploy(admin.address);
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

    async function setNextTimestamp(timestamp: number) {
        await network.provider.send('evm_setNextBlockTimestamp', [timestamp]);
        await network.provider.send('evm_mine');
    }

    async function initializeDefault() {
        await superproToken.transfer(vesting.address, TOTAL_TOKENS);
        await vesting.connect(admin).initialize(superproToken.address, VESTING_START);
    }

    it('should set owner and token addresses on initialize', async function () {
        await initializeDefault();

        expect(await vesting.owner()).be.equal(admin.address);
        expect(await vesting.token()).be.equal(superproToken.address);
    });

    it('should forbid to initialize more than once', async function () {
        await initializeDefault();
        await expect(vesting.connect(admin).initialize(superproToken.address, VESTING_START)).be.revertedWith('Already initialized');
    });

    it('should revert initialize if sender is not the owner', async function () {
        await expect(vesting.connect(impostor).initialize(superproToken.address, VESTING_START)).be.revertedWith('Not allowed');
    });

    it('should forbid to claim if requested more than unlocked', async function () {
        await initializeDefault();
        const tokensPerSec = await vesting.tokensPerSec();
        await expect(vesting.connect(admin).calculateClaim()).be.reverted;

        setNextTimestamp(VESTING_START + 999);
        await vesting.connect(admin).claim(admin.address, tokensPerSec.mul(1000));

        setNextTimestamp(VESTING_START + 1998);
        await expect(vesting.connect(admin).claim(admin.address, tokensPerSec.mul(1000))).be.revertedWith('Requested more than unlocked');
    });

    it('should allow beneficiary to claim all after vesting finished', async function () {
        await initializeDefault();

        setNextTimestamp(VESTING_FINISH);

        await vesting.connect(admin).claim(admin.address, TOTAL_TOKENS);
        expect(await vesting.tokensLocked()).be.equal(0);
        expect(await vesting.tokensClaimed()).be.equal(TOTAL_TOKENS);
        expect(await superproToken.balanceOf(admin.address)).be.equal(TOTAL_TOKENS);
    });

    it('should claim 4 times till the end', async function () {
        await initializeDefault();
        const oneForthDuration = VESTING_DURATION / 4;

        setNextTimestamp(VESTING_START + oneForthDuration);
        await vesting.connect(admin).claim(admin.address, TOTAL_TOKENS.div(4));

        setNextTimestamp(VESTING_START + oneForthDuration * 2);
        await vesting.connect(admin).claim(admin.address, TOTAL_TOKENS.div(4));

        setNextTimestamp(VESTING_START + oneForthDuration * 3);
        await vesting.connect(admin).claim(admin.address, TOTAL_TOKENS.div(4));

        setNextTimestamp(VESTING_START + VESTING_DURATION);
        await vesting.connect(admin).claim(admin.address, TOTAL_TOKENS.div(4));
    });

    it('should transfer authority to another account', async function () {
        await initializeDefault();

        await expect(vesting.connect(deployer).transferAuthority(deployer.address)).be.revertedWith('Not allowed');
        await vesting.connect(admin).transferAuthority(deployer.address);
        expect(await vesting.owner()).be.equal(deployer.address);
    });

    it('should set DAO address as admin', async function () {
        await initializeDefault();

        await expect(vesting.connect(deployer).setDaoAddress(deployer.address)).be.revertedWith('Not allowed');
        await vesting.connect(admin).setDaoAddress(dao.address);
        expect(await vesting.dao()).be.equal(dao.address);
    });
});
