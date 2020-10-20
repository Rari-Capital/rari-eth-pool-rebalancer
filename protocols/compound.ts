import fs from 'fs';
import https from 'https';
import Web3 from 'web3';

const erc20Abi = JSON.parse(fs.readFileSync(__dirname + '/../abi/ERC20.json', 'utf8'));
const cErc20DelegatorAbi = JSON.parse(fs.readFileSync(__dirname + '/compound/CErc20Delegator.json', 'utf8'));
const comptrollerAbi = JSON.parse(fs.readFileSync(__dirname + '/compound/Comptroller.json', 'utf8'));
const interestRateModelAbi = JSON.parse(fs.readFileSync(__dirname + '/compound/InterestRateModel.json', 'utf8'));

export default class CompoundProtocol {
    web3: Web3;
    
    cErc20Contracts = {
        "ETH": "0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5"
    };

    comptrollerContract = "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B";
    compTokenContract = "0xc00e94Cb662C3520282E6f5717214004A7f26888";

    prices = {};
    pricesLastUpdated = 0;

    constructor(web3: Web3) {
        this.web3 = web3;
    }

    async getCashPriorBN(currencyCode, underlyingTokenAddress) {
        var erc20Contract = new this.web3.eth.Contract(erc20Abi, underlyingTokenAddress);

        try {
            return this.web3.utils.toBN(await erc20Contract.methods.balanceOf(this.cErc20Contracts[currencyCode]).call());
        } catch (error) {
            throw "Failed to get prior cash of cToken for " + currencyCode + ": " + error;
        }
    }

    /*
    async predictApr(underlyingTokenAddress, supplyWeiDifferenceBN) {
        return this.supplyRatePerBlockToApr((await this.predictSupplyRatePerBlockBN("ETH", underlyingTokenAddress, supplyWeiDifferenceBN)).toString());
    }
    */

    supplyRatePerBlockToApr(supplyRatePerBlock) {
        // TODO: Use big numbers for Compound APR calculations
        // TODO: Get blocksPerYear dynamically from interestRateModel.blocksPerYear
        // var blocksPerYear = 2102400; // See https://github.com/compound-finance/compound-protocol/blob/v2.6-rc2/contracts/JumpRateModel.sol#L23 and https://github.com/compound-finance/compound-protocol/blob/v2.6-rc2/contracts/WhitePaperInterestRateModel.sol#L24
        const blocksPerDay = 4 * 60 * 24;
        const daysPerYear = 365;
        // var apr = (supplyRatePerBlock / 1e18) * blocksPerYear;
        var apr = (((Math.pow((supplyRatePerBlock / 1e18 * blocksPerDay) + 1, daysPerYear - 1))) - 1);
        return apr;
    }

    async getSupplyRatePerBlock() {
        if (!this.cErc20Contracts["ETH"]) throw "No cToken known for currency code ETH";
        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var cErc20Contract = new this.web3.eth.Contract(cErc20DelegatorAbi, this.cErc20Contracts["ETH"]);

        try {
            return await cErc20Contract.methods.supplyRatePerBlock().call();
        } catch (error) {
            throw "Failed to get Compound ETH supplyRatePerBlock: " + error;
        }
    }


    async getApr() {
        return this.supplyRatePerBlockToApr(await this.getSupplyRatePerBlock());
    }

    
    async getUnderlyingBalance() {
        if (!this.cErc20Contracts["ETH"]) throw "Invalid currency code supplied to CompoundProtocol.getUnderlyingBalance";
        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var cErc20Contract = new this.web3.eth.Contract(cErc20DelegatorAbi, this.cErc20Contracts["ETH"]);
        
        try {
            var balanceOfUnderlying = await cErc20Contract.methods.balanceOfUnderlying(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS).call();
        } catch (error) {
            throw "Error when checking underlying Compound balance of " + "ETH" + ":" + error;
        }

        if (process.env.NODE_ENV !== "production") console.log("CompoundProtocol.getUnderlyingBalance got", balanceOfUnderlying, "ETH");

        return this.web3.utils.toBN(balanceOfUnderlying);
    }

    async claimComp() {
        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var comptrollerContract = new this.web3.eth.Contract(comptrollerAbi, this.comptrollerContract);
        
        // Create claimComp transaction
        var data = comptrollerContract.methods.claimComp([process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS], Object.values(this.cErc20Contracts), false, true).encodeABI();

        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: this.comptrollerContract,
            value: 0,
            data: data,
            nonce: await this.web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };

        if (process.env.NODE_ENV !== "production") console.log("Claiming COMP:", tx);

        // Estimate gas for transaction
        try {
            tx["gas"] = await this.web3.eth.estimateGas(tx);
        } catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for claimComp: " + error;
        }
        
        // Sign transaction
        try {
            var signedTx = await this.web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        } catch (error) {
            throw "Error signing transaction for claimComp: " + error;
        }

        // Send transaction
        try {
            var sentTx = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        } catch (error) {
            throw "Error sending transaction for claimComp: " + error;
        }
        
        console.log("Successfully claimed COMP:", sentTx);
        return sentTx;
    }
    
    getCurrencyUsdRates(currencyCodes) {
        return new Promise((resolve, reject) => {
            https.get('https://api.coingecko.com/api/v3/coins/list', (resp) => {
                let data = '';
    
                // A chunk of data has been recieved
                resp.on('data', (chunk) => {
                    data += chunk;
                });
    
                // The whole response has been received
                resp.on('end', () => {
                    var decoded = JSON.parse(data);
                    if (!decoded) return reject("Failed to decode coins list from CoinGecko");
                    var currencyCodesByCoinGeckoIds = {};

                    for (const currencyCode of currencyCodes) {
                        if (currencyCode === "COMP") currencyCodesByCoinGeckoIds["compound-governance-token"] = "COMP";
                        else if (currencyCode === "REP") currencyCodesByCoinGeckoIds["augur"] = "REP";
                        else currencyCodesByCoinGeckoIds[decoded.find(coin => coin.symbol.toLowerCase() === currencyCode.toLowerCase()).id] = currencyCode;
                    }

                    https.get('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=' + Object.keys(currencyCodesByCoinGeckoIds).join('%2C'), (resp) => {
                        let data = '';
            
                        // A chunk of data has been recieved
                        resp.on('data', (chunk) => {
                            data += chunk;
                        });
            
                        // The whole response has been received
                        resp.on('end', () => {
                            var decoded = JSON.parse(data);
                            if (!decoded) return reject("Failed to decode USD exchange rates from CoinGecko");
                            var prices = {};
                            for (const key of Object.keys(decoded)) prices[currencyCodesByCoinGeckoIds[key]] = ["DAI", "USDC", "USDT", "SAI"].indexOf(currencyCodesByCoinGeckoIds[key]) >= 0 ? 1.0 : decoded[key].usd;
                            resolve(prices);
                        });
                    }).on("error", (err) => {
                        reject("Error requesting currency rates from CoinGecko: " + err.message);
                    });
                });
            }).on("error", (err) => {
                reject("Error requesting currency rates from CoinGecko: " + err.message);
            });
        });
    }

    predictSupplyRatePerBlockFromComp(supplyWeiDifferenceBN = null, currencyDecimals = 18) {
        if (!supplyWeiDifferenceBN) supplyWeiDifferenceBN = this.web3.utils.toBN(0);
        
        return new Promise((resolve, reject) => {
            https.get('https://api.compound.finance/api/v2/ctoken', (resp) => {
                let data = '';
    
                // A chunk of data has been recieved
                resp.on('data', (chunk) => {
                    data += chunk;
                });
    
                // The whole response has been received
                resp.on('end', async () => {
                    var decoded = JSON.parse(data);
                    if (!decoded || !decoded.cToken) reject("Failed to decode cToken list from Compound");

                    // Get cToken USD prices
                    var currencyCodes = ["COMP"];
                    var priceMissing = false;

                    for (const cToken of decoded.cToken) {
                        currencyCodes.push(cToken.underlying_symbol);
                        if (!this.prices[cToken.underlying_symbol]) priceMissing = true;
                    }

                    var now = (new Date()).getTime() / 1000;

                    if (now > this.pricesLastUpdated + parseFloat(process.env.UPDATE_CURRENCY_USD_RATES_INTERVAL_SECONDS) || priceMissing) {
                        this.prices = await this.getCurrencyUsdRates(currencyCodes);
                        console.log(this.prices);
                        this.pricesLastUpdated = now;
                    }
                    
                    // Get currency APY and total yearly interest
                    var currencyUnderlyingSupply = 0;
                    var currencyBorrowUsd = 0;
                    var totalBorrowUsd = 0;
                    
                    for (const cToken of decoded.cToken) {
                        var underlyingBorrow = cToken.total_borrows.value * cToken.exchange_rate.value;
                        var borrowUsd = underlyingBorrow * this.prices[cToken.underlying_symbol];

                        if (cToken.underlying_symbol === "ETH") {
                            currencyUnderlyingSupply = cToken.total_supply.value * cToken.exchange_rate.value;
                            if (supplyWeiDifferenceBN.gt(this.web3.utils.toBN(0))) currencyUnderlyingSupply += parseFloat(supplyWeiDifferenceBN.toString()) / (10 ** currencyDecimals);
                            currencyBorrowUsd = borrowUsd;
                        }

                        totalBorrowUsd += borrowUsd;
                    }
                    
                    // Get APY from COMP per block for this currency
                    var compPerBlock = 0.5;
                    var marketCompPerBlock = compPerBlock * (currencyBorrowUsd / totalBorrowUsd);
                    var marketSupplierCompPerBlock = marketCompPerBlock / 2;
                    var marketSupplierCompPerBlockPerUsd = marketSupplierCompPerBlock / currencyUnderlyingSupply; // Assumes that the value of currencyCode is $1
                    var marketSupplierUsdFromCompPerBlockPerUsd = marketSupplierCompPerBlockPerUsd * this.prices["COMP"];
                    resolve(marketSupplierUsdFromCompPerBlockPerUsd * 1e18);
                });
            });
        });
    }

    
    getAprFromComp(): Promise<any> {
        return new Promise((resolve, reject) => {
            https.get('https://api.compound.finance/api/v2/ctoken', (resp) => {
                let data = '';
                // A chunk of data has been recieved
                resp.on('data', (chunk) => {
                    data += chunk;
                });
                // The whole response has been received
                resp.on('end', async () => {
                    var decoded = JSON.parse(data);
                    if (!decoded || !decoded.cToken) reject("Failed to decode cToken list from Compound");
                    for (const cToken of decoded.cToken) if (cToken.underlying_symbol === "ETH") resolve(cToken.comp_supply_apy.value / 100);
                    reject("Failed to find cToken in Compound API response");
                });
            });
        });
    }

    getAprWithComp(): Promise<any> {
        return new Promise((resolve, reject) => {
            https.get('https://api.compound.finance/api/v2/ctoken', (resp) => {
                let data = '';
                // A chunk of data has been recieved
                resp.on('data', (chunk) => {
                    data += chunk;
                });
                // The whole response has been received
                resp.on('end', async () => {
                    var decoded = JSON.parse(data);
                    if (!decoded || !decoded.cToken) reject("Failed to decode cToken list from Compound");
                    for (const cToken of decoded.cToken) if (cToken.underlying_symbol === "ETH") resolve(parseFloat(cToken.supply_rate.value) + (cToken.comp_supply_apy.value / 100));
                    reject("Failed to find cToken in Compound API response");
                });
            });
        });
    }

    async predictAprFromComp(supplyWeiDifferenceBN, currencyDecimals) {
        return this.supplyRatePerBlockToApr(await this.predictSupplyRatePerBlockFromComp(supplyWeiDifferenceBN, currencyDecimals));
    }
    
    /*
    async predictAprWithComp(underlyingTokenAddress, supplyWeiDifferenceBN, currencyDecimals) {
        return await this.predictApr(underlyingTokenAddress, supplyWeiDifferenceBN) + await this.predictAprFromComp(supplyWeiDifferenceBN, currencyDecimals);
    }
    */
}
