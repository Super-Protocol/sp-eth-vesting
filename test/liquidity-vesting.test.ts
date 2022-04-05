import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { SuperproToken, LiquidityRewardsVesting } from '../typechain';

describe('LiquidityRewardsVesting', function () {
    let superproToken: SuperproToken;
    let vesting: LiquidityRewardsVesting;
    let deployer: SignerWithAddress, admin: SignerWithAddress, impostor: SignerWithAddress, dao: SignerWithAddress;

    const DURATION = 71107200;
    const START = 1654041600;
    const FINISH = 1725148800;
    const TOTAL_TOKENS = parseEther(90_000_000);

    let snapshot: any;

    before(async function () {
        [deployer, admin, impostor, dao] = await ethers.getSigners();
        const SuperproTokenFactory = await ethers.getContractFactory('SuperproToken');
        superproToken = await SuperproTokenFactory.deploy(TOTAL_TOKENS, 'SPT', 'Superpro Test Token');
        await superproToken.deployed();
        const Vesting = await ethers.getContractFactory('LiquidityRewardsVesting');

        vesting = await Vesting.deploy(admin.address);
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
        await superproToken.transfer(vesting.address, TOTAL_TOKENS);
        await vesting.connect(admin).initialize(superproToken.address);
    }

    it('should initialize correctly', async function () {
        await initializeDefault();

        expect(await vesting.owner()).be.equal(admin.address);
        expect(await vesting.token()).be.equal(superproToken.address);
        await expect(vesting.connect(admin).initialize(superproToken.address)).be.revertedWith('Already initialized');
    });

    it('should revert initialize if sender is not the owner', async function () {
        await expect(vesting.connect(impostor).initialize(superproToken.address)).be.revertedWith('Not allowed');
    });

    it('should revert initialize when vesting token balance is lower than desired', async function () {
        await superproToken.transfer(vesting.address, parseEther(89_999_999));
        await expect(vesting.connect(admin).initialize(superproToken.address)).be.revertedWith('Token balance lower than desired');
    });

    it('should forbid to claim if requested more than unlocked', async function () {
        await initializeDefault();
        const tokensPerSec = await vesting.tokensPerSec();
        await expect(vesting.connect(admin).calculateClaim()).be.reverted;

        await network.provider.send('evm_setNextBlockTimestamp', [START + 998]);
        await network.provider.send('evm_mine');
        await expect(vesting.connect(admin).claim(tokensPerSec.mul(1000))).be.revertedWith('Requested more than unlocked');
    });

    it('should allow beneficiary to claim all after vesting finished', async function () {
        await initializeDefault();

        await network.provider.send('evm_setNextBlockTimestamp', [FINISH]);
        await network.provider.send('evm_mine');

        await vesting.connect(admin).claim(TOTAL_TOKENS);
        expect(await vesting.tokensLocked()).be.equal(0);
        expect(await vesting.tokensClaimed()).be.equal(TOTAL_TOKENS);
        expect(await superproToken.balanceOf(admin.address)).be.equal(TOTAL_TOKENS);
    });

    it('should claim 3 times till the end', async function () {
        await initializeDefault();
        const oneForthDuration = DURATION / 4;
        await network.provider.send('evm_setNextBlockTimestamp', [START + oneForthDuration]);
        await network.provider.send('evm_mine');

        await vesting.connect(admin).claim(TOTAL_TOKENS.div(4));

        await network.provider.send('evm_setNextBlockTimestamp', [START + oneForthDuration * 2]);
        await network.provider.send('evm_mine');

        await vesting.connect(admin).claim(TOTAL_TOKENS.div(4));

        await network.provider.send('evm_setNextBlockTimestamp', [START + oneForthDuration * 3]);
        await network.provider.send('evm_mine');

        await vesting.connect(admin).claim(TOTAL_TOKENS.div(4));

        await network.provider.send('evm_setNextBlockTimestamp', [START + DURATION]);
        await network.provider.send('evm_mine');

        await vesting.connect(admin).claim(TOTAL_TOKENS.div(4));
    });

    it('should transfer authority to another account', async function () {
        await initializeDefault();

        await expect(vesting.connect(deployer).transferAuthority(deployer.address)).be.revertedWith('Not allowed');
        await vesting.connect(admin).transferAuthority(deployer.address);
        expect(await vesting.owner()).be.equal(deployer.address);
    });

    it('should set DAO address as admin', async function () {
        await initializeDefault();

        await expect(vesting.connect(deployer).setDAOAddress(deployer.address)).be.revertedWith('Not allowed');
        await vesting.connect(admin).setDAOAddress(dao.address);
        expect(await vesting.DAO()).be.equal(dao.address);
    });
});
