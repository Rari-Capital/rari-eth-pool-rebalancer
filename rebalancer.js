"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const web3_1 = __importDefault(require("web3"));
const dydx_1 = __importDefault(require("./protocols/dydx"));
const compound_1 = __importDefault(require("./protocols/compound"));
const keeperdao_1 = __importDefault(require("./protocols/keeperdao"));
const aave_1 = __importDefault(require("./protocols/aave"));
const _0x_1 = __importDefault(require("./exchanges/0x"));
const erc20Abi = JSON.parse(fs_1.default.readFileSync(__dirname + '/abi/ERC20.json', 'utf8'));
const rariFundControllerAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/abi/RariFundController.json', 'utf8'));
const rariFundManagerAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/abi/RariFundManager.json', 'utf8'));
// Init Web3
var web3 = new web3_1.default(new web3_1.default.providers.HttpProvider(process.env.WEB3_HTTP_PROVIDER_URL));
console.log("Initialized Web3...");
// Init RariFundController and RariFundManager contracts
// TODO: Remove @ts-ignore below
// @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
var fundControllerContract = new web3.eth.Contract(rariFundControllerAbi, process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS);
// @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
var fundManagerContract = new web3.eth.Contract(rariFundManagerAbi, process.env.ETHEREUM_FUND_MANAGER_CONTRACT_ADDRESS);
console.log("Initialized FundController and FundManager contracts...");
// Init protocols
var dydxProtocol = new dydx_1.default(web3);
var compoundProtocol = new compound_1.default(web3);
var keeperDaoProtocol = new keeperdao_1.default(web3);
var aaveProtocol = new aave_1.default(web3);
// Init 0x exchange
var zeroExExchange = new _0x_1.default(web3);
console.log("Initialized protocol instances...");
// Mock currency and pool database
var db = {
    currencies: {
        "ETH": {
            decimals: 18,
            usdRate: 0,
            coinGeckoId: "ethereum",
            tokenAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            lastTimeBalanced: 0
        },
    },
    pools: {
        "dYdX": {
            currencies: {
                "ETH": {
                    poolBalanceBN: web3.utils.toBN(0),
                    supplyApr: 0
                },
            },
            id: 0
        },
        "Compound": {
            currencies: {
                "ETH": {
                    poolBalanceBN: web3.utils.toBN(0),
                    supplyApr: 0
                },
            },
            id: 1
        },
        "KeeperDAO": {
            currencies: {
                "ETH": {
                    poolBalanceBN: web3.utils.toBN(0),
                    supplyApr: 0
                },
            },
            id: 2
        },
        "Aave": {
            currencies: {
                "ETH": {
                    poolBalanceBN: web3.utils.toBN(0),
                    supplyApr: 0
                }
            },
            id: 3
        }
    },
    isBalancingSupply: false,
    lastTimeExchanged: 0
};
function doCycle() {
    return __awaiter(this, void 0, void 0, function* () {
        yield checkPoolBalances();
        yield getAllAprs();
        if (parseInt(process.env.AUTOMATIC_SUPPLY_BALANCING_ENABLED))
            yield tryBalanceSupply();
        setTimeout(doCycle, (process.env.REBALANCER_CYCLE_DELAY_SECONDS ? parseFloat(process.env.REBALANCER_CYCLE_DELAY_SECONDS) : 60) * 1000);
    });
}
function onLoad() {
    return __awaiter(this, void 0, void 0, function* () {
        // Start claiming interest fees regularly
        if (parseInt(process.env.CLAIM_INTEREST_FEES_REGULARLY)) {
            yield tryDepositInterestFees();
            setInterval(function () { tryDepositInterestFees(); }, (process.env.CLAIM_INTEREST_FEES_INTERVAL_SECONDS ? parseFloat(process.env.CLAIM_INTEREST_FEES_INTERVAL_SECONDS) : 86400) * 1000);
        }
        updateKeeperDaoApr();
        // Start claiming and exchanging COMP regularly
        if (parseInt(process.env.CLAIM_AND_EXCHANGE_COMP_REGULARLY)) {
            yield getAllAprs();
            yield tryClaimAndExchangeComp();
            setInterval(function () { tryClaimAndExchangeComp(); }, (process.env.CLAIM_AND_EXCHANGE_COMP_INTERVAL_SECONDS ? parseFloat(process.env.CLAIM_AND_EXCHANGE_COMP_INTERVAL_SECONDS) : 3 * 86400) * 1000);
        }
        // approve WETH to dYdX, kEther to KeeperDAO, and aETH to Aave
        yield approveWethToDydx(web3.utils.toBN(2).pow(web3.utils.toBN(256)).sub(web3.utils.toBN(1)));
        yield approvekEtherToKeeperDao(web3.utils.toBN(2).pow(web3.utils.toBN(256)).sub(web3.utils.toBN(1)));
        // start updating keeperdao exchange rate data every 12 hours
        setInterval(function () { updateKeeperDaoApr(); }, /* 12 * 60 * */ 30 * 1000);
        // Start cycle of checking wallet balances and pool APRs and trying to rebalance to highest apr
        doCycle();
    });
}
onLoad();
/* CLAIMING INTEREST FEES */
function tryDepositInterestFees() {
    return __awaiter(this, void 0, void 0, function* () {
        // Check unclaimed fees
        var unclaimedFees = yield fundManagerContract.methods.getInterestFeesUnclaimed().call();
        if (web3.utils.toBN(unclaimedFees).isZero())
            return null;
        // Deposit fees
        return yield depositInterestFees();
    });
}
function depositInterestFees() {
    return __awaiter(this, void 0, void 0, function* () {
        // Create depositFees transaction
        var data = fundManagerContract.methods.depositFees().encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_MANAGER_CONTRACT_ADDRESS,
            value: 0,
            data: data,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Depositing fees back into fund manager:", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for depositFees: " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for depositFees: " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for depositFees: " + error;
        }
        console.log("Successfully deposited fees back into fund manager:", sentTx);
        return sentTx;
    });
}
/* CLAIM AND EXCHANGE COMP */
function tryClaimAndExchangeComp() {
    return __awaiter(this, void 0, void 0, function* () {
        // Claim COMP
        try {
            yield compoundProtocol.claimComp();
        }
        catch (error) {
            return console.error("Error when claiming COMP:", error);
        }
        // Check balance
        try {
            var balance = yield (new web3.eth.Contract(erc20Abi, compoundProtocol.compTokenContract)).methods.balanceOf(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS).call();
        }
        catch (error) {
            return console.error("Error when retreiving COMP balance of fund controller before trying to exchange:", error);
        }
        var balanceBN = web3.utils.toBN(balance);
        if (balanceBN.isZero())
            return;
        // Approve COMP to 0x if not already
        try {
            if ((yield getCompAllowanceTo0xBN()).lt(web3.utils.toBN(2).pow(web3.utils.toBN(255)).sub(web3.utils.toBN(1))))
                yield setMaxCompAllowanceTo0x();
        }
        catch (error) {
            return console.error(error);
        }
        // Get estimated filled input amount from 0x swap API
        try {
            var [orders, estimatedInputAmountBN, protocolFee, takerAssetFilledAmountBN, gasPrice] = yield zeroExExchange.getSwapOrders(compoundProtocol.compTokenContract, 18, db.currencies["ETH"].tokenAddress, balanceBN, web3.utils.toBN(0));
        }
        catch (error) {
            return console.error("Failed to get swap orders from 0x API when trying to exchange COMP to WETH", ":", error);
        }
        // Exchange tokens!
        try {
            var txid = yield exchangeFunds("COMP", "WETH", takerAssetFilledAmountBN, orders, web3.utils.toBN(protocolFee), web3.utils.toBN(gasPrice));
        }
        catch (error) {
            console.error("Failed to exchange", (balance / 1e18), "COMP to WETH", error);
        }
        try {
            var txid = yield unwrapAllWeth();
        }
        catch (error) {
            console.error("Failed to unwrap WETH received by funciton", error);
        }
    });
}
/* POOL APR CHECKING */
function updateKeeperDaoApr() {
    return __awaiter(this, void 0, void 0, function* () {
        keeperDaoProtocol.lastSavedTimestamp = ((new Date()).getTime() / 1000) - (24 * 60 * 60 * 60);
        keeperDaoProtocol.lastSavedExchangeRate = yield keeperDaoProtocol.getExchangeRate(6450 * 60); // Get exchange rate 6450 blocks ago (6450 blocks/day)
    });
}
function getAllAprs() {
    return __awaiter(this, void 0, void 0, function* () {
        // Get APRs for all pools
        var apr = 0;
        for (const poolName of Object.keys(db.pools)) {
            try {
                if (poolName === "dYdX")
                    apr = yield dydxProtocol.getApr();
                else if (poolName === "Compound")
                    apr = yield compoundProtocol.getAprWithComp();
                else if (poolName === "KeeperDAO")
                    apr = yield keeperDaoProtocol.getApr();
                else if (poolName === "Aave")
                    apr = yield aaveProtocol.getApr();
                else
                    return console.error("Failed to get APRs for unrecognized pool:", poolName);
            }
            catch (error) {
                console.error("Failed to get APR for", poolName, "pool:", error);
                return;
            }
            console.log(poolName, " APR: ", apr);
            db.pools[poolName].currencies["ETH"].supplyApr = apr;
        }
    });
}
/* 0x ALLOWANCES */
function getCompAllowanceTo0xBN() {
    return __awaiter(this, void 0, void 0, function* () {
        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var erc20Contract = new web3.eth.Contract(erc20Abi, compoundProtocol.compTokenContract);
        try {
            return web3.utils.toBN(yield erc20Contract.methods.allowance(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS, "0x95E6F48254609A6ee006F7D493c8e5fB97094ceF").call());
        }
        catch (error) {
            throw "Error when retreiving COMP allowance of FundController to 0x: " + error;
        }
    });
}
function setMaxCompAllowanceTo0x(unset = false) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Setting " + (unset ? "zero" : "max") + " token allowance for COMP on 0x");
        try {
            var txid = yield approveFundsTo0x("COMP", unset ? web3.utils.toBN(0) : web3.utils.toBN(2).pow(web3.utils.toBN(256)).sub(web3.utils.toBN(1)));
        }
        catch (error) {
            throw "Failed to set " + (unset ? "zero" : "max") + " token allowance for COMP on 0x: " + error;
        }
        console.log((unset ? "Zero" : "Max") + " token allowance set successfully for COMP on 0x:", txid);
    });
}
/* BALANCER FUNCTION */
function getBestPool() {
    // Find best pool (to put entire balance in)
    var bestPoolName = null;
    var bestPoolApr = 0;
    for (const poolName of Object.keys(db.pools)) {
        if (db.pools[poolName].currencies["ETH"] && db.pools[poolName].currencies["ETH"].supplyApr > bestPoolApr) {
            bestPoolName = poolName;
            bestPoolApr = db.pools[poolName].currencies["ETH"].supplyApr;
        }
    }
    if (bestPoolName === null)
        throw "Failed to get best pool for ETH";
    return [bestPoolName, bestPoolApr];
}
function getCurrentPoolName() {
    var maxBalance = web3.utils.toBN(0);
    var currentPoolName = null;
    for (const poolName of Object.keys(db.pools)) {
        console.log(poolName, ": ", db.pools[poolName].currencies["ETH"].poolBalanceBN.toString());
        if (db.pools[poolName].currencies["ETH"].poolBalanceBN.gt(maxBalance)) {
            maxBalance = db.pools[poolName].currencies["ETH"].poolBalanceBN;
            currentPoolName = poolName;
        }
    }
    console.log("currentPoolName: ", currentPoolName);
    return currentPoolName;
}
function getCurrentApr() {
    const poolName = getCurrentPoolName();
    return poolName != null ? db.pools[poolName].currencies["ETH"].supplyApr : 0;
}
function tryBalanceSupply() {
    return __awaiter(this, void 0, void 0, function* () {
        if (db.isBalancingSupply)
            return console.warn("Cannot balance supply: supply balancing already in progress");
        db.isBalancingSupply = true;
        console.log("Trying to balance supply");
        try {
            var [bestPoolName, bestApr] = yield getBestPool();
        }
        catch (error) {
            db.isBalancingSupply = false;
            return console.error("Failed to get best currency and pool when trying to balance supply:", error);
        }
        if (bestPoolName == getCurrentPoolName() && (yield getFundControllerImmediateBalance()).eq(web3.utils.toBN(0))) {
            db.isBalancingSupply = false;
            return;
        }
        // Get max miner fees
        try {
            var maxEthereumMinerFeesBN = yield getMaxEthereumMinerFeesForSupplyBalancing(getCurrentPoolName(), bestPoolName);
        }
        catch (error) {
            console.error("Failed to check max Ethereum miner fees before balancing supply:", error);
            return;
        }
        const totalPoolBalance = yield fundManagerContract.methods.getRawFundBalance().call();
        var maxEthereumMinerFees = parseInt(maxEthereumMinerFeesBN.toString()); // TODO: BN.prototype.toNumber replacement
        var maxMinerFees = maxEthereumMinerFees / Math.pow(10, 18);
        var expectedAdditionalYearlyInterest = totalPoolBalance * (bestApr - getCurrentApr());
        var expectedAdditionalYearlyInterest = expectedAdditionalYearlyInterest / Math.pow(10, 18);
        // Get seconds since last supply balancing (if we don't know the last time, assume it's been one week)
        // TODO: Get lastTimeBalanced from a database instead of storing in a variable
        var epoch = (new Date()).getTime() / 1000;
        var secondsSinceLastSupplyBalancing = db.currencies["ETH"].lastTimeBalanced > 0 ? epoch - db.currencies["ETH"].lastTimeBalanced : 86400 * 7;
        // Check AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD
        if (expectedAdditionalYearlyInterest * (secondsSinceLastSupplyBalancing / 86400 / 365) / maxMinerFees < parseFloat(process.env.AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD)) {
            db.isBalancingSupply = false;
            console.log("Not balancing supply of ETH because", expectedAdditionalYearlyInterest, "*", (secondsSinceLastSupplyBalancing / 86400 / 365), "/", maxMinerFees, "is less than", process.env.AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD);
            return;
        }
        console.log("Balancing supply of ETH because", expectedAdditionalYearlyInterest, "*", (secondsSinceLastSupplyBalancing / 86400 / 365), "/", maxMinerFees, "is at least", process.env.AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD);
        // Balance supply!
        try {
            yield doBalanceSupply(db, getCurrentPoolName(), bestPoolName, maxEthereumMinerFeesBN);
        }
        catch (error) {
            db.isBalancingSupply = false;
            console.error("Failed to balance supply of ETH:", error);
            return;
        }
        db.currencies["ETH"].lastTimeBalanced = epoch;
        db.isBalancingSupply = false;
    });
}
function getMaxEthereumMinerFeesForSupplyBalancing(currentPoolName, bestPoolName) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            var gasPrice = yield web3.eth.getGasPrice();
        }
        catch (error) {
            throw "Failed to check ETH gas price to calculate max Ethereum miner fees before balancing supply: " + error;
        }
        var gasNecessary = 250000;
        /*
        for (var i = 0; i < poolBalances.length; i++) {
            if (poolBalances[i].balanceDifferenceBN.gt(web3.utils.toBN(0))) {
                if (poolBalances[i].poolName === "dYdX") gasNecessary += 300000; // TODO: Correct dYdX gas prices
                else if (poolBalances[i].poolName === "Compound") gasNecessary += currencyCode === "DAI" ? 300000 : 150000;
    
                else gasNecessary += 300000; // TODO: Correct default gas price assumption
            } else if (poolBalances[i].balanceDifferenceBN.isNeg()) {
                if (poolBalances[i].poolName === "dYdX") gasNecessary += 300000; // TODO: Correct dYdX gas prices
                else if (poolBalances[i].poolName === "Compound") gasNecessary += 90000;
                else gasNecessary += 300000; // TODO: Correct default gas price assumption
            }
        }
        */
        return web3.utils.toBN(gasNecessary).mul(web3.utils.toBN(gasPrice));
    });
}
function doBalanceSupply(db, currentPoolName, bestPoolName, maxEthereumMinerFeesBN = null) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('\x1b[32m%s\x1b[0m', "Starting to balance supply of ETH from ", currentPoolName, " to ", bestPoolName);
        // Check that we have enough balance for gas fees
        try {
            var ethereumBalance = yield web3.eth.getBalance(process.env.ETHEREUM_ADMIN_ACCOUNT);
        }
        catch (error) {
            throw "Failed to check ETH wallet balance to make sure we have enough funds for fees before balancing supply: " + error;
        }
        if (maxEthereumMinerFeesBN === null) {
            try {
                maxEthereumMinerFeesBN = yield getMaxEthereumMinerFeesForSupplyBalancing(getCurrentPoolName(), bestPoolName);
            }
            catch (error) {
                throw "Failed to check max Ethereum miner fees before balancing supply: " + error;
            }
        }
        if (web3.utils.toBN(ethereumBalance).lt(maxEthereumMinerFeesBN))
            throw "Not enough balance in ETH wallet to cover gas fees to balance supply!"; // TODO: Notify admin well before we run out of ETH for gas
        // Keep track of total balance difference
        var totalFundsBN = currentPoolName ? db.pools[currentPoolName].currencies["ETH"].poolBalanceBN : web3.utils.toBN(0);
        if (currentPoolName == bestPoolName) {
            // if there is ETH that has not been added to a pool, add it to the best pool and return
            try {
                var txid = yield addFunds(bestPoolName, (yield getFundControllerImmediateBalance()));
            }
            catch (error) {
                throw "Failed to add funds to pool when balancing supply of ETH: " + error;
            }
            return;
        }
        if (currentPoolName != null) {
            try {
                var txid = yield removeFunds(currentPoolName, totalFundsBN, true); // remove all funds from current pool
            }
            catch (error) {
                throw "Failed to remove funds from pool " + currentPoolName + " when balancing supply of ETH: " + error;
            }
            db.pools[currentPoolName].currencies["ETH"].poolBalanceBN = web3.utils.toBN(0);
        }
        totalFundsBN = yield getFundControllerImmediateBalance(); // whatever we withdrew from the current pool is in the current balance
        if (!totalFundsBN.eq(web3.utils.toBN(0))) {
            try {
                var txid = yield addFunds(bestPoolName, totalFundsBN);
            }
            catch (error) {
                throw "Failed to add funds to pool when balancing supply of ETH: " + error;
            }
        }
        // Update pool's currency balance
        db.pools[bestPoolName].currencies["ETH"].poolBalanceBN = totalFundsBN;
    });
}
function approveWethToDydx(amountBN) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create depositToPool transaction
        var data = fundControllerContract.methods.approveWethToDydxPool(amountBN).encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
            value: 0,
            data: data,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Approving", amountBN.toString(), "WETH to dYdX:", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for approveWeth of WETH to dYdX: " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for approveToPool of WETH to dYdX: " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for approveWeth of WETH to dYdX: " + error;
        }
        console.log("Successfully approved WETH funds to dYdX:", sentTx);
        return sentTx;
    });
}
function approvekEtherToKeeperDao(amountBN) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create depositToPool transaction
        var data = fundControllerContract.methods.approvekEtherToKeeperDaoPool(amountBN).encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
            value: 0,
            data: data,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Approving", amountBN.toString(), " funds to KeeperDAO:", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for approvekEther of to KeeperDAO: " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for approveToPool of ETH to KeeperDAO: " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for approveToPool of ETH to KeeperDAO: " + error;
        }
        console.log("Successfully approved kEther to KeeperDAO:", sentTx);
        return sentTx;
    });
}
function addFunds(poolName, amountBN) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create depositToPool transaction
        var data = fundControllerContract.methods.depositToPool(db.pools[poolName].id, amountBN).encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
            value: 0,
            data: data,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Adding", amountBN.toString(), "ETH funds to", poolName, ":", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for depositToPool of ETH to " + poolName + ": " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for depositToPool of ETH + to " + poolName + ": " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for depositToPool of ETH to " + poolName + ": " + error;
        }
        console.log("Successfully added ETH funds to", poolName, ":", sentTx);
        return sentTx;
    });
}
function removeFunds(poolName, amountBN, removeAll = false) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create withdrawFromPool transaction
        var data = (removeAll ? fundControllerContract.methods.withdrawAllFromPool(db.pools[poolName].id) : fundControllerContract.methods.withdrawFromPool(db.pools[poolName].id, amountBN)).encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
            value: 0,
            data: data,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Removing", removeAll ? "all of" : amountBN.toString(), " ETH from", poolName, ":", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for " + (removeAll ? "withdrawAllFromPool" : "withdrawFromPool") + " of ETH from " + poolName + ": " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for " + (removeAll ? "withdrawAllFromPool" : "withdrawFromPool") + " of ETH from " + poolName + ": " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for " + (removeAll ? "withdrawAllFromPool" : "withdrawFromPool") + " of ETH from " + poolName + ": " + error;
        }
        console.log("Successfully removed", removeAll ? "all of" : amountBN.toString(), " ETH from", poolName, ":", sentTx);
        return sentTx;
    });
}
function approveFundsTo0x(currencyCode, amountBN) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create depositToPool transaction
        var data = fundControllerContract.methods.approveCompTo0x(amountBN).encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
            value: 0,
            data: data,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Approving", amountBN.toString(), currencyCode, "funds to 0x:", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for approveTo0x of " + currencyCode + ": " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for approveTo0x of " + currencyCode + ": " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for approveTo0x of " + currencyCode + ": " + error;
        }
        console.log("Successfully approved", currencyCode, "funds to 0x:", sentTx);
        return sentTx;
    });
}
function exchangeFunds(inputCurrencyCode, outputCurrencyCode, takerAssetFillAmountBN, orders, protocolFeeBN, gasPriceBN) {
    return __awaiter(this, void 0, void 0, function* () {
        // Build array of orders and signatures
        var signatures = [];
        for (var i = 0; i < orders.length; i++) {
            signatures[i] = orders[i].signature;
            orders[i] = {
                makerAddress: orders[i].makerAddress,
                takerAddress: orders[i].takerAddress,
                feeRecipientAddress: orders[i].feeRecipientAddress,
                senderAddress: orders[i].senderAddress,
                makerAssetAmount: orders[i].makerAssetAmount,
                takerAssetAmount: orders[i].takerAssetAmount,
                makerFee: orders[i].makerFee,
                takerFee: orders[i].takerFee,
                expirationTimeSeconds: orders[i].expirationTimeSeconds,
                salt: orders[i].salt,
                makerAssetData: orders[i].makerAssetData,
                takerAssetData: orders[i].takerAssetData,
                makerFeeAssetData: orders[i].makerFeeAssetData,
                takerFeeAssetData: orders[i].takerFeeAssetData
            };
        }
        // Create marketSell0xOrdersFillOrKill transaction
        var data = fundControllerContract.methods.marketSell0xOrdersFillOrKill(orders, signatures, takerAssetFillAmountBN).encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
            value: protocolFeeBN,
            data: data,
            gasPrice: gasPriceBN,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Exchanging up to", takerAssetFillAmountBN.toString(), inputCurrencyCode, "to", outputCurrencyCode, ":", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for marketSell0xOrdersFillOrKill to exchange " + inputCurrencyCode + " to " + outputCurrencyCode + ": " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for marketSell0xOrdersFillOrKill to exchange " + inputCurrencyCode + " to " + outputCurrencyCode + ": " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for marketSell0xOrdersFillOrKill to exchange " + inputCurrencyCode + " to " + outputCurrencyCode + ": " + error;
        }
        console.log("Successfully exchanged", inputCurrencyCode, "to", outputCurrencyCode, ":", sentTx);
        return sentTx;
    });
}
function unwrapAllWeth() {
    return __awaiter(this, void 0, void 0, function* () {
        // Create depositToPool transaction
        var data = fundControllerContract.methods.unwrapAllWeth().encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
            value: 0,
            data: data,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Unwrapping all WETH...", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for unwrapping all WETH.";
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for unwrapping all WETH";
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for unwrapping all WETH.";
        }
        console.log("Successfully unwrapped all WETH.", sentTx);
        return sentTx;
    });
}
function checkPoolBalances() {
    return __awaiter(this, void 0, void 0, function* () {
        // Get balances for all pools
        for (const poolName of Object.keys(db.pools)) {
            try {
                if (poolName === "dYdX") {
                    // Might as well get all dYdX balances since it doesn't cost us anything
                    db.pools[poolName].currencies["ETH"].poolBalanceBN = yield dydxProtocol.getUnderlyingBalance();
                }
                else if (poolName === "Compound") {
                    try {
                        db.pools[poolName].currencies["ETH"].poolBalanceBN = yield compoundProtocol.getUnderlyingBalance();
                    }
                    catch (error) {
                        return console.error("Failed to get ETH balance on Compound:", error);
                    }
                }
                else if (poolName === "KeeperDAO") {
                    db.pools[poolName].currencies["ETH"].poolBalanceBN = yield keeperDaoProtocol.getUnderlyingBalance();
                }
                else if (poolName === "Aave") {
                    db.pools[poolName].currencies["ETH"].poolBalanceBN = yield aaveProtocol.getUnderlyingBalance();
                }
                else {
                    console.error("Unrecognized pool name: ", poolName);
                }
            }
            catch (error) {
                console.error("Failed to get balance of ETH for ", poolName, " pool:", error);
            }
            console.log(poolName, " getUnderlyingBalance: ", db.pools[poolName].currencies["ETH"].poolBalanceBN.toString());
        }
    });
}
function getFundControllerImmediateBalance() {
    return __awaiter(this, void 0, void 0, function* () {
        const contractBalance = yield web3.eth.getBalance(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS);
        return web3.utils.toBN(contractBalance);
    });
}
//# sourceMappingURL=rebalancer.js.map