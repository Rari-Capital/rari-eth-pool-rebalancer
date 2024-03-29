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
const https_1 = __importDefault(require("https"));
const dydx_1 = __importDefault(require("./protocols/dydx"));
const compound_1 = __importDefault(require("./protocols/compound"));
const _0x_1 = __importDefault(require("./exchanges/0x"));
const erc20Abi = JSON.parse(fs_1.default.readFileSync(__dirname + '/abi/ERC20.json', 'utf8'));
const rariFundControllerAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/abi/RariFundController.json', 'utf8'));
const rariFundManagerAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/abi/RariFundManager.json', 'utf8'));
// Init Web3
var web3 = new web3_1.default(new web3_1.default.providers.HttpProvider(process.env.WEB3_HTTP_PROVIDER_URL));
// Init RariFundController and RariFundManager contracts
// TODO: Remove @ts-ignore below
// @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
var fundControllerContract = new web3.eth.Contract(rariFundControllerAbi, process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS);
// @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
var fundManagerContract = new web3.eth.Contract(rariFundManagerAbi, process.env.ETHEREUM_FUND_MANAGER_CONTRACT_ADDRESS);
// Init protocols
var dydxProtocol = new dydx_1.default(web3);
var compoundProtocol = new compound_1.default(web3);
// Init 0x exchange
var zeroExExchange = new _0x_1.default(web3);
// Mock currency and pool database
var db = {
    currencies: {
        "ETH": {
            decimals: 18,
            usdRate: 0,
            coinGeckoId: "ethereum"
        },
    },
    pools: {
        "dYdX": {
            currencies: {
                "WETH": {
                    poolBalanceBN: web3.utils.toBN(0),
                    supplyApr: 0
                },
            }
        },
        "Compound": {
            currencies: {
                "ETH": {
                    poolBalanceBN: web3.utils.toBN(0),
                    supplyApr: 0
                },
            }
        }
    },
    isBalancingSupply: false,
    lastTimeExchanged: 0
};
function doCycle() {
    return __awaiter(this, void 0, void 0, function* () {
        yield checkAllBalances();
        yield getAllAprs();
        // await setAcceptedCurrencies();
        if (parseInt(process.env.AUTOMATIC_SUPPLY_BALANCING_ENABLED))
            yield tryBalanceSupply();
        setTimeout(doCycle, (process.env.REBALANCER_CYCLE_DELAY_SECONDS ? parseFloat(process.env.REBALANCER_CYCLE_DELAY_SECONDS) : 60) * 1000);
    });
}
function onLoad() {
    return __awaiter(this, void 0, void 0, function* () {
        // Start updating USD rates regularly
        //await updateCurrencyUsdRates();
        // setInterval(function() { updateCurrencyUsdRates(); }, (process.env.UPDATE_CURRENCY_USD_RATES_INTERVAL_SECONDS ? parseFloat(process.env.UPDATE_CURRENCY_USD_RATES_INTERVAL_SECONDS) : 60) * 1000);
        // Start claiming interest fees regularly
        if (parseInt(process.env.CLAIM_INTEREST_FEES_REGULARLY)) {
            yield tryDepositInterestFees();
            setInterval(function () { tryDepositInterestFees(); }, (process.env.CLAIM_INTEREST_FEES_INTERVAL_SECONDS ? parseFloat(process.env.CLAIM_INTEREST_FEES_INTERVAL_SECONDS) : 86400) * 1000);
        }
        // Start claiming and exchanging COMP regularly
        if (parseInt(process.env.CLAIM_AND_EXCHANGE_COMP_REGULARLY)) {
            yield getAllAprs();
            yield tryClaimAndExchangeComp();
            setInterval(function () { tryClaimAndExchangeComp(); }, (process.env.CLAIM_AND_EXCHANGE_COMP_INTERVAL_SECONDS ? parseFloat(process.env.CLAIM_AND_EXCHANGE_COMP_INTERVAL_SECONDS) : 3 * 86400) * 1000);
        }
        // Set max token allowances to pools and 0x
        yield setMaxTokenAllowances();
        // Start cycle of checking wallet balances and pool APRs and trying to balance supply of all currencies
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
        // Get best currency for currency exchange
        try {
            var [bestCurrencyCode] = yield getBestCurrencyAndPool();
        }
        catch (error) {
            return console.error("Failed to get best currency when trying to exchange COMP:", error);
        }
        // Approve COMP to 0x if not already
        try {
            if ((yield getTokenAllowanceTo0xBN("COMP")).lt(web3.utils.toBN(2).pow(web3.utils.toBN(255)).sub(web3.utils.toBN(1))))
                yield setMaxTokenAllowanceTo0x("COMP");
        }
        catch (error) {
            return console.error(error);
        }
        // Get estimated filled input amount from 0x swap API
        try {
            var [orders, estimatedInputAmountBN, protocolFee, takerAssetFilledAmountBN, gasPrice] = yield zeroExExchange.getSwapOrders(compoundProtocol.compTokenContract, 18, db.currencies[bestCurrencyCode].tokenAddress, balanceBN, web3.utils.toBN(0));
        }
        catch (error) {
            return console.error("Failed to get swap orders from 0x API when trying to exchange COMP to", bestCurrencyCode, ":", error);
        }
        // Exchange tokens!
        try {
            var txid = yield exchangeFunds("COMP", bestCurrencyCode, takerAssetFilledAmountBN, orders, web3.utils.toBN(protocolFee), web3.utils.toBN(gasPrice));
        }
        catch (error) {
            console.error("Failed to exchange", (balance / 1e18), "COMP to", bestCurrencyCode, ":", error);
        }
    });
}
/* SETTING ACCEPTED CURRENCIES */
/*
async function setAcceptedCurrencies() {
    // Get best currencies and pools for potential currency exchange
    try {
        var pools = await getBestCurrenciesAndPools();
    } catch (error) {
        return console.error("Failed to get best currencies and pools when trying to set accepted currencies:", error);
    }

    var currenciesChecked = [];
    
    for (var i = 0; i < pools.length; i++) {
        if (currenciesChecked.indexOf(pools[i].currencyCode) >= 0) continue;
        currenciesChecked.push(pools[i].currencyCode);
        var accepted = await fundManagerContract.methods.isCurrencyAccepted(pools[i].currencyCode).call();
        var shouldBeAccepted = i == 0 || pools[i].supplyApr >= pools[0].supplyApr * 0.9;

        try {
            if (!accepted && shouldBeAccepted) await setAcceptedCurrency(pools[i].currencyCode, true);
            else if (accepted && !shouldBeAccepted) await setAcceptedCurrency(pools[i].currencyCode, false);
        } catch (error) {
            return console.error(error);
        }
    }
}
*/
/* POOL APR CHECKING */
function getAllAprs() {
    return __awaiter(this, void 0, void 0, function* () {
        // Get APRs for all pools
        for (const key of Object.keys(db.pools)) {
            try {
                if (key === "dYdX")
                    var aprs = yield dydxProtocol.getAprs(Object.keys(db.pools[key].currencies));
                else if (key == "Compound")
                    var aprs = yield compoundProtocol.getAprsWithComp(Object.keys(db.pools[key].currencies));
                else
                    return console.error("Failed to get APRs for unrecognized pool:", key);
            }
            catch (error) {
                console.error("Failed to get APRs for", key, "pool:", error);
                return;
            }
            for (const key2 of Object.keys(aprs)) {
                db.pools[key].currencies[key2].supplyApr = aprs[key2];
            }
        }
    });
}
/* TOKEN ALLOWANCES -- don't need for ETH */
function setMaxTokenAllowances() {
    return __awaiter(this, void 0, void 0, function* () {
        for (const poolName of Object.keys(db.pools))
            for (const currencyCode of Object.keys(db.pools[poolName].currencies)) {
                try {
                    if ((yield getTokenAllowanceToPoolBN(poolName, currencyCode)).lt(web3.utils.toBN(2).pow(web3.utils.toBN(255)).sub(web3.utils.toBN(1))))
                        yield setMaxTokenAllowanceToPool(poolName, currencyCode);
                }
                catch (error) {
                    console.error(error);
                }
            }
        for (const currencyCode of Object.keys(db.currencies))
            if (currencyCode != "ETH") {
                try {
                    if ((yield getTokenAllowanceTo0xBN(currencyCode)).lt(web3.utils.toBN(2).pow(web3.utils.toBN(255)).sub(web3.utils.toBN(1))))
                        yield setMaxTokenAllowanceTo0x(currencyCode);
                }
                catch (error) {
                    console.error(error);
                }
            }
    });
}
function getTokenAllowanceToPoolBN(poolName, currencyCode) {
    return __awaiter(this, void 0, void 0, function* () {
        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var erc20Contract = new web3.eth.Contract(erc20Abi, db.currencies[currencyCode].tokenAddress);
        try {
            return web3.utils.toBN(yield erc20Contract.methods.allowance(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS, poolName == "Compound" ? compoundProtocol.cErc20Contracts[currencyCode] : dydxProtocol.soloMarginContract.options.address).call());
        }
        catch (error) {
            throw "Error when retreiving " + currencyCode + " allowance of FundController to " + poolName + ": " + error;
        }
    });
}
function setMaxTokenAllowanceToPool(poolName, currencyCode, unset = false) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Setting " + (unset ? "zero" : "max") + " token allowance for", currencyCode, "on", poolName);
        try {
            var txid = yield approveFundsToPool(poolName, currencyCode, unset ? web3.utils.toBN(0) : web3.utils.toBN(2).pow(web3.utils.toBN(256)).sub(web3.utils.toBN(1)));
        }
        catch (error) {
            throw "Failed to set " + (unset ? "zero" : "max") + " token allowance for " + currencyCode + " on " + poolName + ": " + error;
        }
        console.log((unset ? "Zero" : "Max") + " token allowance set successfully for", currencyCode, "on", poolName, ":", txid);
    });
}
function getTokenAllowanceTo0xBN(currencyCode) {
    return __awaiter(this, void 0, void 0, function* () {
        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var erc20Contract = new web3.eth.Contract(erc20Abi, currencyCode === "COMP" ? compoundProtocol.compTokenContract : db.currencies[currencyCode].tokenAddress);
        try {
            return web3.utils.toBN(yield erc20Contract.methods.allowance(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS, "0x95E6F48254609A6ee006F7D493c8e5fB97094ceF").call());
        }
        catch (error) {
            throw "Error when retreiving " + currencyCode + " allowance of FundController to 0x: " + error;
        }
    });
}
function setMaxTokenAllowanceTo0x(currencyCode, unset = false) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Setting " + (unset ? "zero" : "max") + " token allowance for", currencyCode, "on 0x");
        try {
            var txid = yield approveFundsTo0x(currencyCode, unset ? web3.utils.toBN(0) : web3.utils.toBN(2).pow(web3.utils.toBN(256)).sub(web3.utils.toBN(1)));
        }
        catch (error) {
            throw "Failed to set " + (unset ? "zero" : "max") + " token allowance for " + currencyCode + " on 0x: " + error;
        }
        console.log((unset ? "Zero" : "Max") + " token allowance set successfully for", currencyCode, "on 0x:", txid);
    });
}
/* CURRENCY USD RATE UPDATING */
function updateCurrencyUsdRates() {
    return __awaiter(this, void 0, void 0, function* () {
        var currencyCodesByCoinGeckoIds = {};
        for (const currencyCode of Object.keys(db.currencies))
            currencyCodesByCoinGeckoIds[db.currencies[currencyCode].coinGeckoId] = currencyCode;
        https_1.default.get('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=' + Object.keys(currencyCodesByCoinGeckoIds).join('%2C'), (resp) => {
            let data = '';
            // A chunk of data has been recieved
            resp.on('data', (chunk) => {
                data += chunk;
            });
            // The whole response has been received
            resp.on('end', () => {
                var decoded = JSON.parse(data);
                if (!decoded)
                    return console.error("Failed to decode USD exchange rates from CoinGecko");
                for (const key of Object.keys(decoded))
                    db.currencies[currencyCodesByCoinGeckoIds[key]].usdRate = decoded[key].usd;
            });
        }).on("error", (err) => {
            console.error("Error requesting currency rates from CoinGecko:", err.message);
        });
    });
}
/* POOL BALANCING */
function predictApr(currencyCode, poolName, balanceDifferenceBN) {
    return __awaiter(this, void 0, void 0, function* () {
        if (poolName === "dYdX")
            return yield dydxProtocol.predictApr(currencyCode, db.currencies[currencyCode].tokenAddress, balanceDifferenceBN);
        else if (poolName == "Compound")
            return yield compoundProtocol.predictAprWithComp(currencyCode, db.currencies[currencyCode].tokenAddress, balanceDifferenceBN, db.currencies[currencyCode].decimals);
        else
            throw "Failed to predict APR for unrecognized pool: " + poolName;
    });
}
function predictBalanceDifferenceBN(currencyCode, poolName, targetApr, aprAtEstimatedBalanceDifference, estimatedBalanceDifferenceBN) {
    return __awaiter(this, void 0, void 0, function* () {
        // Keep guessing: estimatedBalanceDifference = estimatedBalanceDifference / (currentApr - aprAtEstimatedBalanceDifference) * (currentApr - targetApr)
        // Return estimatedBalanceDifference once aprAtEstimatedBalanceDifference is within 1% of targetApr or if we get stuck in a loop
        // TODO: Come up with a better way to avoid getting stuck in a loop than limiting the number of estimates to 10
        var currentApr = db.pools[poolName].currencies[currencyCode].supplyApr;
        for (var i = 0; i < 10; i++) {
            if (Math.abs(targetApr - aprAtEstimatedBalanceDifference) <= targetApr / 100)
                break;
            estimatedBalanceDifferenceBN = estimatedBalanceDifferenceBN.muln((currentApr - targetApr) / (currentApr - aprAtEstimatedBalanceDifference) * 1e18).divn(1e18);
            aprAtEstimatedBalanceDifference = yield predictApr(currencyCode, poolName, estimatedBalanceDifferenceBN);
        }
        return estimatedBalanceDifferenceBN;
    });
}
// TODO: Implement proportional currency rebalancing using APR predictions
/* async function getIdealBalancesAllCurrencies(totalBalanceDifferenceUsdBN = web3.utils.toBN(0)) {
    // Get total USD balance
    var totalUsdBN = getRawCombinedUsdBalanceBN();
    
    // Add difference to totalBalance if supplied to this function
    totalUsdBN.iadd(totalBalanceDifferenceUsdBN);
    if (totalUsdBN.isNeg()) throw "Total balance would be negative";

    // Sort all currency-pool combinations by highest to lowest supply rate
    var currencyPoolCombinations = [];
    for (const poolName of Object.keys(db.pools))
        for (const currencyCode of Object.keys(db.pools[poolName].currencies))
            currencyPoolCombinations.push({ currencyCode, poolName, supplyApr: db.pools[poolName].currencies[currencyCode].supplyApr });
    if (currencyPoolCombinations.length <= 1) return currencyPoolCombinations;
    currencyPoolCombinations.sort((a, b) => (a.supplyApr < b.supplyApr) ? 1 : -1);

    // Calculate balance differences and balances
    for (var i = 0; i < currencyPoolCombinations.length; i++) {
        var minApr = currencyPoolCombinations[i + 1] ? currencyPoolCombinations[i + 1].supplyApr : 0;
        var maxBalanceDifference = parseInt(totalUsdBN.toString()) / db.currencies[currencyPoolCombinations[i].currencyCode].usdRate;

        // Predict APR at maxBalanceDifference
        try {
            var predictedApr = await predictApr(currencyPoolCombinations[i].currencyCode, currencyPoolCombinations[i].poolName, web3.utils.toBN(maxBalanceDifference));
        } catch {
            throw "Failed to predict APR";
        }

        if (predictedApr >= minApr) {
            // Set balance difference to maximum since predicted APR is not below the minimum
            currencyPoolCombinations[i].balanceDifferenceBN = web3.utils.toBN(maxBalanceDifference);
            currencyPoolCombinations[i].balanceBN = db.pools[currencyPoolCombinations[i].poolName].currencies[currencyPoolCombinations[i].currencyCode].poolBalanceBN.add(currencyPoolCombinations[i].balanceDifferenceBN);

            // Set other pools' balances to 0 and return
            for (var j = i + 1; j < currencyPoolCombinations.length; j++) {
                currencyPoolCombinations[j].balanceDifferenceBN = web3.utils.toBN(0).sub(db.pools[currencyPoolCombinations[j].poolName].currencies[currencyPoolCombinations[j].currencyCode].poolBalanceBN);
                currencyPoolCombinations[j].balanceBN = 0;
            }

            return currencyPoolCombinations;
        } else {
            // Predict balance difference necessary to equalize APR with the next highest
            try {
                currencyPoolCombinations[i].balanceDifferenceBN = await predictBalanceDifferenceBN(currencyPoolCombinations[i].currencyCode, currencyPoolCombinations[i].poolName, minApr, predictedApr, web3.utils.toBN(maxBalanceDifference));
            } catch {
                throw "Failed to predict balance difference";
            }

            currencyPoolCombinations[i].balanceBN = db.pools[currencyPoolCombinations[i].poolName].currencies[currencyPoolCombinations[i].currencyCode].poolBalanceBN.add(currencyPoolCombinations[i].balanceDifferenceBN);
            totalUsdBN.isubn(currencyPoolCombinations[i].balanceDifferenceBN.toString() * db.currencies[currencyPoolCombinations[i].currencyCode].usdRate);
        }
    }

    return currencyPoolCombinations;
} */
function getIdealBalancesByCurrency(currencyCode, totalBalanceDifferenceBN = web3.utils.toBN(0)) {
    return __awaiter(this, void 0, void 0, function* () {
        // Get total balance of this currency
        var totalBN = getRawTotalBalanceBN(currencyCode);
        // Add difference to totalBalance if supplied to this function
        totalBN.iadd(totalBalanceDifferenceBN);
        if (totalBN.isNeg())
            throw "Total balance would be negative";
        // Sort all pools for this currency by highest to lowest supply rate
        var pools = [];
        for (const poolName of Object.keys(db.pools))
            if (db.pools[poolName].currencies[currencyCode])
                pools.push({ poolName, supplyApr: db.pools[poolName].currencies[currencyCode].supplyApr });
        pools.sort((a, b) => (a.supplyApr < b.supplyApr) ? 1 : -1);
        // Calculate balance differences and balances
        for (var i = 0; i < pools.length; i++) {
            var minApr = pools[i + 1] ? pools[i + 1].supplyApr : 0;
            var maxBalanceDifferenceBN = totalBN.sub(db.pools[pools[i].poolName].currencies[currencyCode].poolBalanceBN);
            if (!parseInt(process.env.PROPORTIONAL_SUPPLY_BALANCING_ENABLED) || minApr <= 0) {
                // Set balance difference to maximum since there are no other APRs > 0
                pools[i].balanceDifferenceBN = maxBalanceDifferenceBN;
                pools[i].balanceBN = db.pools[pools[i].poolName].currencies[currencyCode].poolBalanceBN.add(pools[i].balanceDifferenceBN);
                // Set other pools' balances to 0 and break
                for (var j = i + 1; j < pools.length; j++) {
                    pools[j].balanceBN = web3.utils.toBN(0);
                    pools[j].balanceDifferenceBN = web3.utils.toBN(0).sub(db.pools[pools[j].poolName].currencies[currencyCode].poolBalanceBN);
                }
                break;
            }
            // Predict APR at maxBalanceDifferenceBN
            try {
                var predictedApr = yield predictApr(currencyCode, pools[i].poolName, maxBalanceDifferenceBN);
            }
            catch (error) {
                throw "Failed to predict APR: " + error;
            }
            if (predictedApr >= minApr) {
                // Set balance difference to maximum since predicted APR is not below the minimum
                pools[i].balanceDifferenceBN = maxBalanceDifferenceBN;
                pools[i].balanceBN = db.pools[pools[i].poolName].currencies[currencyCode].poolBalanceBN.add(pools[i].balanceDifferenceBN);
                // Set other pools' balances to 0 and break
                for (var j = i + 1; j < pools.length; j++) {
                    pools[j].balanceBN = web3.utils.toBN(0);
                    pools[j].balanceDifferenceBN = web3.utils.toBN(0).sub(db.pools[pools[j].poolName].currencies[currencyCode].poolBalanceBN);
                }
                break;
            }
            else {
                // Predict balance difference necessary to equalize APR with the next highest
                try {
                    pools[i].balanceDifferenceBN = yield predictBalanceDifferenceBN(currencyCode, pools[i].poolName, minApr, predictedApr, maxBalanceDifferenceBN);
                }
                catch (error) {
                    throw "Failed to predict balance difference: " + error;
                }
                pools[i].balanceBN = db.pools[pools[i].poolName].currencies[currencyCode].poolBalanceBN.add(pools[i].balanceDifferenceBN);
                totalBN.isubn(pools[i].balanceBN.toString());
            }
        }
        if (process.env.NODE_ENV !== "production")
            console.log("Ideal balances of", currencyCode, ":", JSON.stringify(pools, null, 2));
        return pools;
    });
}
function getBestCurrenciesAndPools() {
    return __awaiter(this, void 0, void 0, function* () {
        var pools = [];
        for (const poolName of Object.keys(db.pools))
            for (const currencyCode of Object.keys(db.pools[poolName].currencies))
                pools.push({ currencyCode, poolName, supplyApr: db.pools[poolName].currencies[currencyCode].supplyApr });
        return pools.sort((a, b) => (a.supplyApr < b.supplyApr) ? 1 : -1);
    });
}
function getBestCurrencyAndPool() {
    return __awaiter(this, void 0, void 0, function* () {
        // Find best currency and pool (to put entire balance in)
        var bestCurrencyCode = null;
        var bestPoolName = null;
        var bestApr = 0;
        for (const poolName of Object.keys(db.pools)) {
            for (const currencyCode of Object.keys(db.pools[poolName].currencies)) {
                if (db.pools[poolName].currencies[currencyCode].supplyApr > bestApr) {
                    bestCurrencyCode = currencyCode;
                    bestPoolName = poolName;
                    bestApr = db.pools[poolName].currencies[currencyCode].supplyApr;
                }
            }
        }
        if (bestPoolName === null)
            throw "Failed to get best currency and pool";
        return [bestCurrencyCode, bestPoolName, bestApr];
    });
}
function getBestPoolByCurrency(currencyCode) {
    // Find best pool for this currency (to put entire balance in)
    var bestPoolName = null;
    var bestPoolApr = 0;
    for (const poolName of Object.keys(db.pools)) {
        if (db.pools[poolName].currencies[currencyCode] && db.pools[poolName].currencies[currencyCode].supplyApr > bestPoolApr) {
            bestPoolName = poolName;
            bestPoolApr = db.pools[poolName].currencies[currencyCode].supplyApr;
        }
    }
    if (bestPoolName === null)
        throw "Failed to get best pool for " + currencyCode;
    return [bestPoolName, bestPoolApr];
}
function getRawTotalBalanceBN(currencyCode) {
    // Calculate raw total balance of this currency: start with fundControllerContractBalanceBN
    var totalBalanceBN = db.currencies[currencyCode].fundControllerContractBalanceBN;
    // Add pool balances to totalBalanceBN
    for (const poolName of Object.keys(db.pools))
        if (db.pools[poolName].currencies[currencyCode])
            totalBalanceBN.iadd(db.pools[poolName].currencies[currencyCode].poolBalanceBN);
    return totalBalanceBN;
}
/* function getRawCombinedUsdBalanceBN() {
    // Calculate raw combined USD balance
    var usdBalanceBN = web3.utils.toBN(0);

    // Add currency balances to usdBalanceBN
    for (const currencyCode of Object.keys(db.currencies))
        if (currencyCode !== "ETH")
            usdBalanceBN.iadd(getRawTotalBalanceBN(currencyCode));

    return usdBalanceBN;
} */
function tryBalanceSupply() {
    return __awaiter(this, void 0, void 0, function* () {
        if (db.isBalancingSupply)
            return console.warn("Cannot balance supply: supply balancing already in progress");
        db.isBalancingSupply = true;
        console.log("Trying to balance supply");
        if (parseInt(process.env.AUTOMATIC_TOKEN_EXCHANGE_ENABLED)) {
            // Get best currency and pool for potential currency exchange
            // TODO: Implement proportional currency rebalancing using APR predictions
            try {
                var [bestCurrencyCode, bestPoolName, bestApr] = yield getBestCurrencyAndPool();
            }
            catch (error) {
                db.isBalancingSupply = false;
                return console.error("Failed to get best currency and pool when trying to balance supply:", error);
            }
            // Loop through tokens for exchanges to best currency code
            currency_loop: for (const currencyCode of Object.keys(db.currencies))
                if (currencyCode !== "ETH" && currencyCode !== bestCurrencyCode) {
                    // Convert a maximum of the currency's raw total balance at a maximum marginal output according to AUTOMATIC_TOKEN_EXCHANGE_MAX_SLIPPAGE_PER_APR_INCREASE_PER_YEAR_SINCE_LAST_REBALANCING
                    var maxInputAmountBN = getRawTotalBalanceBN(currencyCode);
                    if (maxInputAmountBN.gt(web3.utils.toBN(0))) {
                        // Calculate min marginal output amount to exchange funds
                        try {
                            var price = yield zeroExExchange.getPrice(currencyCode, bestCurrencyCode);
                        }
                        catch (error) {
                            db.isBalancingSupply = false;
                            console.error("Failed to get price of", currencyCode, "to", bestCurrencyCode, "from 0x API when trying to balance supply:", error);
                            continue;
                        }
                        try {
                            var [bestPoolNameForThisCurrency, bestAprForThisCurrency] = yield getBestPoolByCurrency(currencyCode);
                        }
                        catch (error) {
                            db.isBalancingSupply = false;
                            console.error("Failed to get best pool of", currencyCode, "when trying to balance supply:", error);
                            continue;
                        }
                        // Get seconds since last supply balancing (if we don't know the last time, assume it's been one week)
                        // TODO: Get lastTimeBalanced from a database instead of storing in a variable
                        var epoch = (new Date()).getTime() / 1000;
                        var secondsSinceLastExchange = db.lastTimeExchanged > 0 ? epoch - db.lastTimeExchanged : 86400 * 7;
                        // TODO: Include miner fee and 0x protocol fee in calculation of min marginal output amount
                        // TODO: Are we sure we want to use stablecoin trade prices and not $1 flat for slippage calculations? Same question goes for the web client (which currently uses $1 flat and not stablecoin trade prices since RariFundManager assumes all tokens are worth $1)
                        var maxMarginalOutputAmount = 1 / parseFloat(price);
                        var minMarginalOutputAmountBN = web3.utils.toBN(Math.trunc(maxMarginalOutputAmount * (1 - (parseFloat(process.env.AUTOMATIC_TOKEN_EXCHANGE_MAX_SLIPPAGE_PER_APR_INCREASE_PER_YEAR_SINCE_LAST_EXCHANGE) * (bestApr - bestAprForThisCurrency) * (secondsSinceLastExchange / 86400 / 365))) * (Math.pow(10, db.currencies[bestCurrencyCode].decimals))));
                        // Get estimated filled input amount from 0x swap API
                        try {
                            var [orders, estimatedInputAmountBN, protocolFee, takerAssetFilledAmountBN, gasPrice] = yield zeroExExchange.getSwapOrders(db.currencies[currencyCode].tokenAddress, db.currencies[currencyCode].decimals, db.currencies[bestCurrencyCode].tokenAddress, maxInputAmountBN, minMarginalOutputAmountBN);
                        }
                        catch (error) {
                            db.isBalancingSupply = false;
                            console.error("Failed to get swap orders from 0x API when trying to balance supply:", error);
                            continue;
                        }
                        // Withdraw estimatedInputAmountBN tokens from pools in order of lowest to highest supply rate
                        var poolNames = Object.keys(db.pools);
                        poolNames.sort((a, b) => (db.pools[a].supplyApr > db.pools[b].supplyApr) ? 1 : -1);
                        for (const poolName of poolNames) {
                            if (db.currencies[currencyCode].fundControllerContractBalanceBN.gte(estimatedInputAmountBN))
                                break;
                            var leftBN = estimatedInputAmountBN.sub(db.currencies[currencyCode].fundControllerContractBalanceBN);
                            var withdrawalAmountBN = leftBN.lte(db.pools[poolName].currencies[currencyCode].poolBalanceBN) ? leftBN : db.pools[poolName].currencies[currencyCode].poolBalanceBN;
                            // TODO: Don't execute a supply removal if not above a threshold
                            try {
                                var txid = yield removeFunds(poolName, currencyCode, withdrawalAmountBN, withdrawalAmountBN.eq(db.pools[poolName].currencies[currencyCode].poolBalanceBN));
                            }
                            catch (error) {
                                console.error("Failed to remove funds from pool " + poolName + " when balancing supply of " + currencyCode + " before token exchange: " + error);
                                continue;
                            }
                            // Update balances
                            db.pools[poolName].currencies[currencyCode].poolBalanceBN.isub(withdrawalAmountBN);
                            db.currencies[currencyCode].fundControllerContractBalanceBN.iadd(withdrawalAmountBN);
                        }
                        // Exchange tokens!
                        try {
                            var txid = yield exchangeFunds(currencyCode, bestCurrencyCode, takerAssetFilledAmountBN, orders, web3.utils.toBN(protocolFee), web3.utils.toBN(gasPrice));
                        }
                        catch (error) {
                            // Retry up to 2 more times
                            for (var i = 0; i < 2; i++) {
                                try {
                                    var [orders, newEstimatedInputAmountBN, protocolFee, takerAssetFilledAmountBN, gasPrice] = yield zeroExExchange.getSwapOrders(db.currencies[currencyCode].tokenAddress, db.currencies[currencyCode].decimals, db.currencies[bestCurrencyCode].tokenAddress, estimatedInputAmountBN, minMarginalOutputAmountBN);
                                }
                                catch (error) {
                                    db.isBalancingSupply = false;
                                    console.error("Failed to get swap orders from 0x API when trying to balance supply:", error);
                                    continue currency_loop;
                                }
                                try {
                                    var txid = yield exchangeFunds(currencyCode, bestCurrencyCode, takerAssetFilledAmountBN, orders, web3.utils.toBN(protocolFee), web3.utils.toBN(gasPrice));
                                    break;
                                }
                                catch (error) {
                                    // Stop trying on 3rd error
                                    if (i == 1) {
                                        db.isBalancingSupply = false;
                                        console.error("Failed 3 times to exchange", currencyCode, "to", bestCurrencyCode, "when balancing supply:", error);
                                        continue currency_loop;
                                    }
                                }
                            }
                        }
                        yield checkTokenBalances(currencyCode);
                        yield checkTokenBalances(bestCurrencyCode);
                    }
                }
        }
        // Loop through tokens again for rebalancing across pools
        for (const currencyCode of Object.keys(db.currencies))
            if (currencyCode !== "ETH") {
                // Get ideal balances
                try {
                    var idealBalances = yield getIdealBalancesByCurrency(currencyCode);
                }
                catch (error) {
                    db.isBalancingSupply = false;
                    console.error("Failed to get ideal balances when trying to balance supply of", currencyCode, ":", error);
                    continue;
                }
                // Check for any changes in ideal balances
                var anyChanges = false;
                for (var i = 0; i < idealBalances.length; i++)
                    if (!idealBalances[i].balanceDifferenceBN.isZero())
                        anyChanges = true;
                if (anyChanges) {
                    // Get expected additional yearly interest
                    var expectedAdditionalYearlyInterest = 0;
                    for (var i = 0; i < idealBalances.length; i++) {
                        var balanceDifference = parseInt(idealBalances[i].balanceDifferenceBN.toString()); // TODO: BN.prototype.toNumber replacement
                        expectedAdditionalYearlyInterest += balanceDifference * idealBalances[i].supplyApr;
                    }
                    var expectedAdditionalYearlyInterestUsd = expectedAdditionalYearlyInterest / Math.pow(10, db.currencies[currencyCode].decimals) * db.currencies[currencyCode].usdRate;
                    // Get max miner fees
                    try {
                        var maxEthereumMinerFeesBN = yield getMaxEthereumMinerFeesForSupplyBalancing(currencyCode, idealBalances);
                    }
                    catch (error) {
                        console.error("Failed to check max Ethereum miner fees before balancing supply:", error);
                        continue;
                    }
                    var maxEthereumMinerFees = parseInt(maxEthereumMinerFeesBN.toString()); // TODO: BN.prototype.toNumber replacement
                    var maxMinerFeesUsd = maxEthereumMinerFees / Math.pow(10, 18) * db.currencies["ETH"].usdRate;
                    // Get seconds since last supply balancing (if we don't know the last time, assume it's been one week)
                    // TODO: Get lastTimeBalanced from a database instead of storing in a variable
                    var epoch = (new Date()).getTime() / 1000;
                    var secondsSinceLastSupplyBalancing = db.currencies[currencyCode].lastTimeBalanced > 0 ? epoch - db.currencies[currencyCode].lastTimeBalanced : 86400 * 7;
                    // Check AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD
                    if (expectedAdditionalYearlyInterestUsd * (secondsSinceLastSupplyBalancing / 86400 / 365) / maxMinerFeesUsd < parseFloat(process.env.AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD)) {
                        db.isBalancingSupply = false;
                        console.log("Not balancing supply of", currencyCode, "because", expectedAdditionalYearlyInterestUsd, "*", (secondsSinceLastSupplyBalancing / 86400 / 365), "/", maxMinerFeesUsd, "is less than", process.env.AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD);
                        continue;
                    }
                    console.log("Balancing supply of", currencyCode, "because", expectedAdditionalYearlyInterestUsd, "*", (secondsSinceLastSupplyBalancing / 86400 / 365), "/", maxMinerFeesUsd, "is at least", process.env.AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD);
                    // Balance supply!
                    try {
                        yield doBalanceSupply(db, currencyCode, idealBalances, maxEthereumMinerFeesBN);
                    }
                    catch (error) {
                        db.isBalancingSupply = false;
                        console.error("Failed to balance supply of", currencyCode, ":", error);
                        continue;
                    }
                    db.currencies[currencyCode].lastTimeBalanced = epoch;
                }
                else
                    console.log("Not balancing supply of", currencyCode, "because no change in balances");
            }
        db.isBalancingSupply = false;
    });
}
function getMaxEthereumMinerFeesForSupplyBalancing(currencyCode, poolBalances) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            var gasPrice = yield web3.eth.getGasPrice();
        }
        catch (error) {
            throw "Failed to check ETH gas price to calculate max Ethereum miner fees before balancing supply: " + error;
        }
        var gasNecessary = 0;
        for (var i = 0; i < poolBalances.length; i++) {
            if (poolBalances[i].balanceDifferenceBN.gt(web3.utils.toBN(0))) {
                if (poolBalances[i].poolName === "dYdX")
                    gasNecessary += 300000; // TODO: Correct dYdX gas prices
                else if (poolBalances[i].poolName === "Compound")
                    gasNecessary += currencyCode === "DAI" ? 300000 : 150000;
                else
                    gasNecessary += 300000; // TODO: Correct default gas price assumption
            }
            else if (poolBalances[i].balanceDifferenceBN.isNeg()) {
                if (poolBalances[i].poolName === "dYdX")
                    gasNecessary += 300000; // TODO: Correct dYdX gas prices
                else if (poolBalances[i].poolName === "Compound")
                    gasNecessary += 90000;
                else
                    gasNecessary += 300000; // TODO: Correct default gas price assumption
            }
        }
        return web3.utils.toBN(gasNecessary).mul(web3.utils.toBN(gasPrice));
    });
}
function doBalanceSupply(db, currencyCode, poolBalances, maxEthereumMinerFeesBN = null) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('\x1b[32m%s\x1b[0m', "Starting to balance supply of", currencyCode); // Green color
        // Check that we have enough balance for gas fees
        try {
            var ethereumBalance = yield web3.eth.getBalance(process.env.ETHEREUM_ADMIN_ACCOUNT);
        }
        catch (error) {
            throw "Failed to check ETH wallet balance to make sure we have enough funds for fees before balancing supply: " + error;
        }
        if (maxEthereumMinerFeesBN === null) {
            try {
                maxEthereumMinerFeesBN = yield getMaxEthereumMinerFeesForSupplyBalancing(currencyCode, poolBalances);
            }
            catch (error) {
                throw "Failed to check max Ethereum miner fees before balancing supply: " + error;
            }
        }
        if (web3.utils.toBN(ethereumBalance).lt(maxEthereumMinerFeesBN))
            throw "Not enough balance in ETH wallet to cover gas fees to balance supply!"; // TODO: Notify admin well before we run out of ETH for gas
        // Keep track of total balance difference 
        var totalBalanceDifferenceBN = web3.utils.toBN(0);
        // Execute all supply removals
        for (var i = 0; i < poolBalances.length; i++)
            if (poolBalances[i].balanceDifferenceBN.isNeg()) {
                // TODO: Don't execute a supply removal if not above a threshold
                try {
                    var txid = yield removeFunds(poolBalances[i].poolName, currencyCode, poolBalances[i].balanceDifferenceBN.abs(), poolBalances[i].balanceBN.isZero());
                }
                catch (error) {
                    throw "Failed to remove funds from pool " + poolBalances[i].poolName + " when balancing supply of " + currencyCode + ": " + error;
                }
                // Update pool's currency balance
                db.pools[poolBalances[i].poolName].currencies[currencyCode].poolBalanceBN = poolBalances[i].balanceBN;
                totalBalanceDifferenceBN.iadd(poolBalances[i].balanceDifferenceBN);
            }
        // Execute all supply additions
        // TODO: Make sure supply removals have updated (and confirmed?) before adding funds
        // TODO: Don't fail to execute the last addition due to rounding inaccuracies
        // TODO: Don't fail to execute the last addition due to transaction fees on our tokens
        for (var i = 0; i < poolBalances.length; i++)
            if (poolBalances[i].balanceDifferenceBN.gt(web3.utils.toBN(0))) {
                // TODO: Don't execute a supply addition if not above a threshold
                try {
                    var txid = yield addFunds(poolBalances[i].poolName, currencyCode, poolBalances[i].balanceDifferenceBN);
                }
                catch (error) {
                    throw "Failed to add funds to pool when balancing supply of " + currencyCode + ": " + error;
                }
                // Update pool's currency balance
                db.pools[poolBalances[i].poolName].currencies[currencyCode].poolBalanceBN = poolBalances[i].balanceBN;
                totalBalanceDifferenceBN.iadd(poolBalances[i].balanceDifferenceBN);
            }
        // Update wallet balance in mock database
        db.currencies[currencyCode].fundControllerContractBalanceBN = db.currencies[currencyCode].fundControllerContractBalanceBN.sub(totalBalanceDifferenceBN);
    });
}
function approveFundsToPool(poolName, currencyCode, amountBN) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create depositToPool transaction
        var data = fundControllerContract.methods.approveToPool(poolName == "Compound" ? 1 : 0, currencyCode, amountBN).encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
            value: 0,
            data: data,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Approving", amountBN.toString(), currencyCode, "funds to", poolName, ":", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for approveToPool of " + currencyCode + " to " + poolName + ": " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for approveToPool of " + currencyCode + " to " + poolName + ": " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for approveToPool of " + currencyCode + " to " + poolName + ": " + error;
        }
        console.log("Successfully approved", currencyCode, "funds to", poolName, ":", sentTx);
        return sentTx;
    });
}
function addFunds(poolName, currencyCode, amountBN) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create depositToPool transaction
        var data = fundControllerContract.methods.depositToPool(poolName == "Compound" ? 1 : 0, currencyCode, amountBN).encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
            value: 0,
            data: data,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Adding", amountBN.toString(), currencyCode, "funds to", poolName, ":", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for depositToPool of " + currencyCode + " to " + poolName + ": " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for depositToPool of " + currencyCode + " to " + poolName + ": " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for depositToPool of " + currencyCode + " to " + poolName + ": " + error;
        }
        console.log("Successfully added", currencyCode, "funds to", poolName, ":", sentTx);
        return sentTx;
    });
}
function removeFunds(poolName, currencyCode, amountBN, removeAll = false) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create withdrawFromPool transaction
        var data = (removeAll ? fundControllerContract.methods.withdrawAllFromPool(poolName == "Compound" ? 1 : 0, currencyCode) : fundControllerContract.methods.withdrawFromPool(poolName == "Compound" ? 1 : 0, currencyCode, amountBN)).encodeABI();
        // Build transaction
        var tx = {
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
            value: 0,
            data: data,
            nonce: yield web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
        };
        if (process.env.NODE_ENV !== "production")
            console.log("Removing", removeAll ? "all of" : amountBN.toString(), currencyCode, "from", poolName, ":", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for " + (removeAll ? "withdrawAllFromPool" : "withdrawFromPool") + " of " + currencyCode + " from " + poolName + ": " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for " + (removeAll ? "withdrawAllFromPool" : "withdrawFromPool") + " of " + currencyCode + " from " + poolName + ": " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for " + (removeAll ? "withdrawAllFromPool" : "withdrawFromPool") + " of " + currencyCode + " from " + poolName + ": " + error;
        }
        console.log("Successfully removed", removeAll ? "all of" : amountBN.toString(), currencyCode, "from", poolName, ":", sentTx);
        return sentTx;
    });
}
function approveFundsTo0x(currencyCode, amountBN) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create depositToPool transaction
        var data = fundControllerContract.methods.approveTo0x(currencyCode === "COMP" ? compoundProtocol.compTokenContract : db.currencies[currencyCode].tokenAddress, amountBN).encodeABI();
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
/* WALLET BALANCE CHECKING */
function checkAllTokenBalances() {
    return __awaiter(this, void 0, void 0, function* () {
        yield checkFundControllerContractTokenBalances();
        yield checkPoolBalances();
    });
}
function checkTokenBalances(currencyCode) {
    return __awaiter(this, void 0, void 0, function* () {
        yield checkFundControllerContractTokenBalance(currencyCode);
        yield checkTokenPoolBalances(currencyCode);
    });
}
function checkFundControllerContractTokenBalances() {
    return __awaiter(this, void 0, void 0, function* () {
        for (const currencyCode of Object.keys(db.currencies))
            if (currencyCode !== "ETH")
                yield checkFundControllerContractTokenBalance(currencyCode);
    });
}
function checkFundControllerContractTokenBalance(currencyCode) {
    return __awaiter(this, void 0, void 0, function* () {
        // Check wallet balance for this currency
        try {
            var balance = yield getFundControllerContractErc20Balance(db.currencies[currencyCode].tokenAddress);
        }
        catch (error) {
            console.error("Error getting", currencyCode, "wallet balance:", error);
            return;
        }
        // Update mock database
        db.currencies[currencyCode].fundControllerContractBalanceBN = web3.utils.toBN(balance);
    });
}
function getFundControllerContractErc20Balance(erc20ContractAddress) {
    return __awaiter(this, void 0, void 0, function* () {
        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var erc20Contract = new web3.eth.Contract(erc20Abi, erc20ContractAddress);
        try {
            return yield erc20Contract.methods.balanceOf(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS).call();
        }
        catch (error) {
            throw "Error when retreiving ERC20 balance of FundController: " + error;
        }
    });
}
function checkPoolBalances() {
    return __awaiter(this, void 0, void 0, function* () {
        // Get balances for all pools
        for (const poolName of Object.keys(db.pools)) {
            try {
                if (poolName === "dYdX") {
                    var currencyCodesByTokenAddress = {};
                    for (const currencyCode of Object.keys(db.pools[poolName].currencies))
                        currencyCodesByTokenAddress[db.currencies[currencyCode].tokenAddress] = currencyCode;
                    var balances = yield dydxProtocol.getUnderlyingBalances(currencyCodesByTokenAddress);
                }
                else if (poolName == "Compound")
                    var balances = yield compoundProtocol.getUnderlyingBalances(Object.keys(db.pools[poolName].currencies));
                else
                    return console.error("Failed to get balances for unrecognized pool:", poolName);
            }
            catch (error) {
                console.error("Failed to get balances for", poolName, "pool:", error);
                return;
            }
            for (const currencyCode of Object.keys(balances))
                db.pools[poolName].currencies[currencyCode].poolBalanceBN = balances[currencyCode];
        }
    });
}
function checkTokenPoolBalances(currencyCode) {
    return __awaiter(this, void 0, void 0, function* () {
        // Get balances for all pools
        for (const poolName of Object.keys(db.pools)) {
            try {
                if (poolName === "dYdX") {
                    // Might as well get all dYdX balances since it doesn't cost us anything
                    // Yes, I know I am overwriting currencyCode; doesn't matter
                    var currencyCodesByTokenAddress = {};
                    for (const currencyCode of Object.keys(db.pools[poolName].currencies))
                        currencyCodesByTokenAddress[db.currencies[currencyCode].tokenAddress] = currencyCode;
                    var balances = yield dydxProtocol.getUnderlyingBalances(currencyCodesByTokenAddress);
                    for (const currencyCode of Object.keys(balances))
                        db.pools[poolName].currencies[currencyCode].poolBalanceBN = balances[currencyCode];
                }
                else if (poolName == "Compound") {
                    try {
                        db.pools[poolName].currencies[currencyCode].poolBalanceBN = yield compoundProtocol.getUnderlyingBalance(currencyCode);
                    }
                    catch (error) {
                        return console.error("Failed to get", currencyCode, "balance on Compound:", error);
                    }
                }
                else
                    return console.error("Failed to get balances for unrecognized pool:", poolName);
            }
            catch (error) {
                console.error("Failed to get balance of", currencyCode, "for", poolName, "pool:", error);
            }
        }
    });
}
//# sourceMappingURL=index.js.map