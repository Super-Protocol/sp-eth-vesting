import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-etherscan';
import '@typechain/hardhat';
import 'hardhat-gas-reporter';
import 'hardhat-contract-sizer';
import 'solidity-coverage';
import { utils } from 'ethers';
import { config } from './config';

export default {
    solidity: {
        version: '0.8.9',
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
        bail: true,
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
                accountsBalance: utils.parseEther('100000000').toString(),
                count: 10,
            },
        },
        rinkeby: {
            url: config.rinkebyUrl,
            accounts: [config.privateKey],
        },
        mainnet: {
            url: '',
        },
    },
    etherscan: {
        apiKey: config.etherscanApiKey,
    },
};
