import '@typechain/hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-ethers';
import 'hardhat-contract-sizer';
import 'hardhat-gas-reporter';
import 'solidity-docgen';
import 'solidity-coverage';
import '@nomicfoundation/hardhat-verify';
import { config } from './config';
import { parseEther } from 'ethers';
import './tasks/initializeInsiderVesting';
import './tasks/InitializeVesting';
import 'dotenv/config';

export default {
    solidity: {
        version: '0.8.30',
        settings: {
            viaIR: true,
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
        bscTestnet: {
            chainId: 97,
            url: config.rpcUrl,
            accounts: [config.deployerPrivateKey],
        },
        bsc: {
            chainId: 56,
            url: config.rpcUrl,
            accounts: [config.deployerPrivateKey],
        },
    },
    etherscan: {
        apiKey: {
            bsc: process.env.ETHERSCAN_API_KEY,
        },
        customChains: [
            {
                network: 'bsc',
                chainId: 56,
                urls: {
                    apiURL: 'https://api.etherscan.io/v2/api?chainid=56',
                    browserURL: 'https://bscscan.com/',
                },
            },
        ],
    },
};
