import '@typechain/hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import 'hardhat-contract-sizer';
import 'solidity-docgen';
import 'solidity-coverage';
import { config } from './config';
import { parseEther } from 'ethers';
import './tasks/initializeInsiderVesting';
import './tasks/InitializeVesting';

export default {
    solidity: {
        version: '0.8.30',
        settings: {
            optimizer: {
                enabled: true,
                runs: 1000,
            },
        },
    },
    contractSizer: {
        alphaSort: false,
        disambiguatePaths: true,
        runOnCompile: true,
        strict: false,
    },
    gasReporter: {
        enabled: true,
        currency: 'USD',
    },
    mocha: {
        timeout: 0,
        bail: config.mochaBail,
    },
    typechain: {
        outDir: 'typechain',
        target: 'ethers-v6',
    },
    networks: {
        hardhat: {
            chainId: 1337,
            mining: {
                auto: true,
            },
            gasPrice: 1,
            initialBaseFeePerGas: 1,
            accounts: {
                accountsBalance: parseEther('100000000').toString(),
                count: 10,
            },
        },
        local: {
            url: 'http://127.0.0.1:8545',
            accounts: ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'],
        },
        opbnbTestnet: {
            chainId: 5611,
            url: config.rpcUrl,
            accounts: [config.deployerPrivateKey],
        },
        opbnb: {
            chainId: 204,
            url: config.rpcUrl,
            accounts: [config.deployerPrivateKey],
        },
    },
};
