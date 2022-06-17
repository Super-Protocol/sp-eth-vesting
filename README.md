# Useful commands
### Setup
```sh
cp .env.example .env
```
Fill in the fields: 
• TEST_PRIVATE_KEY - key of local node deployer account  
• PRIVATE_KEY - key of deployer account  
• INITIALIZER - initializer account (address)  
• MAINNET_URL - RPC node url  
• ETHERSCAN_API_KEY - api key of block explorer  

### Tests

```sh
$ npx hardhat test
$ npx hardhat test test/vesting.test.ts --show-stack-traces
```

### Deploy to locale node

```sh
$ npx hardhat node
$ npx hardhat run scripts/deployVesting.ts --network local
$ npx hardhat run scripts/deployInsiderVesting.ts --network local
$ ethernal listen
```

### Deploy to other networks

```sh
$ npx hardhat run scripts/deployVesting.ts --network <network_name>
$ npx hardhat run scripts/deployInsiderVesting.ts --network <network_name>
```

### Verify code
```sh
npx hardhat verify --network <network_name> <contract_address> <initializer_address>
```

### Prettier and linter

```sh
$ npm run eslint
$ npm run prettier
$ npx prettier --write 'contracts/**/*.sol'
```

# Useful plugins and extensions

* Visual Studio Code ESLint extension: https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint
