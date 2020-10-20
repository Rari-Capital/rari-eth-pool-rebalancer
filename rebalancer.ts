import fs from 'fs';
import Web3 from 'web3';
import https from 'https';

import DydxProtocol from './protocols/dydx';
import CompoundProtocol from './protocols/compound';
import KeeperDaoProtocol from './protocols/keeperdao'
import AaveProtocol from './protocols/aave';
import ZeroExExchange from './exchanges/0x';

const erc20Abi = JSON.parse(fs.readFileSync(__dirname + '/abi/ERC20.json', 'utf8'));
const rariFundControllerAbi = JSON.parse(fs.readFileSync(__dirname + '/abi/RariFundController.json', 'utf8'));
const rariFundManagerAbi = JSON.parse(fs.readFileSync(__dirname + '/abi/RariFundManager.json', 'utf8'));

// Init Web3
var web3 = new Web3(new Web3.providers.HttpProvider(process.env.WEB3_HTTP_PROVIDER_URL));

console.log("Initialized Web3...");

// Init RariFundController and RariFundManager contracts
// TODO: Remove @ts-ignore below
// @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
var fundControllerContract = new web3.eth.Contract(rariFundControllerAbi, process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS);
// @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
var fundManagerContract = new web3.eth.Contract(rariFundManagerAbi, process.env.ETHEREUM_FUND_MANAGER_CONTRACT_ADDRESS);

console.log("Initialized FundController and FundManager contracts...");

// Init protocols
var dydxProtocol = new DydxProtocol(web3);
var compoundProtocol = new CompoundProtocol(web3);
var keeperDaoProtocol = new KeeperDaoProtocol(web3);
var aaveProtocol = new AaveProtocol(web3);

// Init 0x exchange
var zeroExExchange = new ZeroExExchange(web3);

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

async function doCycle() {
    await checkPoolBalances();
    await getAllAprs();
    if (parseInt(process.env.AUTOMATIC_SUPPLY_BALANCING_ENABLED)) await tryBalanceSupply();
    setTimeout(doCycle, (process.env.REBALANCER_CYCLE_DELAY_SECONDS ? parseFloat(process.env.REBALANCER_CYCLE_DELAY_SECONDS) : 60) * 1000);
}


async function onLoad() {
    // Start updating ETH/USD rate regularly
    await updateEthUsdRates();
    setInterval(function() { updateEthUsdRates(); }, (process.env.UPDATE_CURRENCY_USD_RATES_INTERVAL_SECONDS ? parseFloat(process.env.UPDATE_CURRENCY_USD_RATES_INTERVAL_SECONDS) : 60) * 1000);
    // Start claiming interest fees regularly
    if (parseInt(process.env.CLAIM_INTEREST_FEES_REGULARLY)) {
        await tryDepositInterestFees();
        setInterval(function() { tryDepositInterestFees(); }, (process.env.CLAIM_INTEREST_FEES_INTERVAL_SECONDS ? parseFloat(process.env.CLAIM_INTEREST_FEES_INTERVAL_SECONDS) : 86400) * 1000);
    }

    updateKeeperDaoApr();

    // Start claiming and exchanging COMP regularly
    if (parseInt(process.env.CLAIM_AND_EXCHANGE_COMP_REGULARLY)) {
        await getAllAprs();
        await tryClaimAndExchangeComp();
        setInterval(function() { tryClaimAndExchangeComp(); }, (process.env.CLAIM_AND_EXCHANGE_COMP_INTERVAL_SECONDS ? parseFloat(process.env.CLAIM_AND_EXCHANGE_COMP_INTERVAL_SECONDS) : 3 * 86400) * 1000);
    }

    // approve WETH to dYdX, kEther to KeeperDAO, and aETH to Aave
    await approveWethToDydx(web3.utils.toBN(2).pow(web3.utils.toBN(256)).sub(web3.utils.toBN(1)));
    await approvekEtherToKeeperDao(web3.utils.toBN(2).pow(web3.utils.toBN(256)).sub(web3.utils.toBN(1)));

    // start updating keeperdao exchange rate data every 12 hours
    setInterval(function() { updateKeeperDaoApr(); }, /* 12 * 60 * */ 30 * 1000);

    // Start cycle of checking wallet balances and pool APRs and trying to rebalance to highest apr
    doCycle();
}

onLoad();

/* CLAIMING INTEREST FEES */

async function tryDepositInterestFees() {
    // Check unclaimed fees
    var unclaimedFees = await fundManagerContract.methods.getInterestFeesUnclaimed().call();
    if (web3.utils.toBN(unclaimedFees).isZero()) return null;

    // Deposit fees
    return await depositInterestFees();
}

async function depositInterestFees() {
    // Create depositFees transaction
    var data = fundManagerContract.methods.depositFees().encodeABI();

    // Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: process.env.ETHEREUM_FUND_MANAGER_CONTRACT_ADDRESS,
        value: 0,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.log("Depositing fees back into fund manager:", tx);

    // Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending transaction for depositFees: " + error;
    }
    
    // Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing transaction for depositFees: " + error;
    }

    // Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending transaction for depositFees: " + error;
    }
    
    console.log("Successfully deposited fees back into fund manager:", sentTx);
    return sentTx;
}


/* CLAIM AND EXCHANGE COMP */

async function tryClaimAndExchangeComp() {
    // Claim COMP
    try {
        await compoundProtocol.claimComp();
    } catch (error) {
        return console.error("Error when claiming COMP:", error);
    }

    // Check balance
    try {
        var balance = await (new web3.eth.Contract(erc20Abi, compoundProtocol.compTokenContract)).methods.balanceOf(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS).call();
    } catch (error) {
        return console.error("Error when retreiving COMP balance of fund controller before trying to exchange:", error);
    }

    var balanceBN = web3.utils.toBN(balance);

    if (balanceBN.isZero()) return;
    
    // Approve COMP to 0x if not already
    try {
        if ((await getCompAllowanceTo0xBN()).lt(web3.utils.toBN(2).pow(web3.utils.toBN(255)).sub(web3.utils.toBN(1))))
            await setMaxCompAllowanceTo0x();
    } catch (error) {
        return console.error(error);
    }

    // Get estimated filled input amount from 0x swap API
    try {
        var [orders, estimatedInputAmountBN, protocolFee, takerAssetFilledAmountBN, gasPrice] = await zeroExExchange.getSwapOrders(compoundProtocol.compTokenContract, 18, db.currencies["ETH"].tokenAddress, balanceBN, web3.utils.toBN(0));
    } catch (error) {
        return console.error("Failed to get swap orders from 0x API when trying to exchange COMP to WETH", ":", error);
    }

    // Exchange tokens!
    try {
        var txid = await exchangeFunds("COMP", "WETH", takerAssetFilledAmountBN, orders, web3.utils.toBN(protocolFee), web3.utils.toBN(gasPrice));
    } catch (error) {
        console.error("Failed to exchange", (balance / 1e18), "COMP to WETH", error);
    }

    try {
    	var txid = await unwrapAllWeth();
    } catch (error) {
    	console.error("Failed to unwrap WETH received by funciton", error);
    }
}



/* POOL APR CHECKING */

async function updateKeeperDaoApr() {
	keeperDaoProtocol.lastSavedTimestamp = ((new Date()).getTime() / 1000) - (24 * 60 * 60 * 60);
	keeperDaoProtocol.lastSavedExchangeRate = await keeperDaoProtocol.getExchangeRate(6450 * 60); // Get exchange rate 6450 blocks ago (6450 blocks/day)
}


async function getAllAprs() {
    // Get APRs for all pools
    var apr = 0;

    for (const poolName of Object.keys(db.pools)) {
        try {
            if (poolName === "dYdX") apr = await dydxProtocol.getApr();
            else if (poolName === "Compound") apr = await compoundProtocol.getAprWithComp();
            else if (poolName === "KeeperDAO") apr = await keeperDaoProtocol.getApr();
            else if (poolName === "Aave") apr = await aaveProtocol.getApr();
            else return console.error("Failed to get APRs for unrecognized pool:", poolName);
        } catch (error) {
            console.error("Failed to get APR for", poolName, "pool:", error);
        }
        
        console.log(poolName, " APR: ", apr);

        db.pools[poolName].currencies["ETH"].supplyApr = apr;

    }

}


/* 0x ALLOWANCES */

async function getCompAllowanceTo0xBN() {
    // TODO: Remove @ts-ignore below
    // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
    var erc20Contract = new web3.eth.Contract(erc20Abi, compoundProtocol.compTokenContract);

    try {
        return web3.utils.toBN(await erc20Contract.methods.allowance(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS, "0x95E6F48254609A6ee006F7D493c8e5fB97094ceF").call());
    } catch (error) {
        throw "Error when retreiving COMP allowance of FundController to 0x: " + error;
    }
}

async function setMaxCompAllowanceTo0x(unset = false) {
    console.log("Setting " + (unset ? "zero" : "max") + " token allowance for COMP on 0x");

    try {
        var txid = await approveFundsTo0x("COMP", unset ? web3.utils.toBN(0) : web3.utils.toBN(2).pow(web3.utils.toBN(256)).sub(web3.utils.toBN(1)));
    } catch (error) {
        throw "Failed to set " + (unset ? "zero" : "max") + " token allowance for COMP on 0x: " + error;
    }
    
    console.log((unset ? "Zero" : "Max") + " token allowance set successfully for COMP on 0x:", txid);
}

/* CURRENCY USD RATE UPDATING */

async function updateEthUsdRates() {
    var currencyCodesByCoinGeckoIds = {};
    for (const currencyCode of Object.keys(db.currencies)) currencyCodesByCoinGeckoIds[db.currencies[currencyCode].coinGeckoId] = currencyCode;
    
    https.get('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=ethereum', (resp) => {
        let data = '';

        // A chunk of data has been recieved
        resp.on('data', (chunk) => {
            data += chunk;
        });

        // The whole response has been received
        resp.on('end', () => {
            var decoded = JSON.parse(data);
            if (!decoded) return console.error("Failed to decode USD exchange rates from CoinGecko");
            db.currencies["ETH"].usdRate = decoded["ethereum"].usd;
        });
    }).on("error", (err) => {
        console.error("Error requesting currency rates from CoinGecko:", err.message);
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
    
    if (bestPoolName === null) throw "Failed to get best pool for ETH";

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


async function tryBalanceSupply() {
    if (db.isBalancingSupply) return console.warn("Cannot balance supply: supply balancing already in progress");
    
    db.isBalancingSupply = true;

    console.log("Trying to balance supply");

    try {
        var [bestPoolName, bestApr] = await getBestPool();
    } catch (error) {
        db.isBalancingSupply = false;
   	    return console.error("Failed to get best currency and pool when trying to balance supply:", error);
    }

    if (bestPoolName == getCurrentPoolName() && (await getFundControllerImmediateBalance()).eq(web3.utils.toBN(0))) {
        console.log("No new funds to rebalance.");
    	db.isBalancingSupply = false;
    	return;
    }

    // Get max miner fees
    try {
        var maxEthereumMinerFeesBN = await getMaxEthereumMinerFeesForSupplyBalancing(getCurrentPoolName(), bestPoolName);
    } catch (error) {
        console.error("Failed to check max Ethereum miner fees before balancing supply:", error);
        return;
    }

    const totalPoolBalanceBN = (await getFundControllerImmediateBalance()).add(db.pools[getCurrentPoolName()].currencies["ETH"].poolBalanceBN);
    const totalPoolBalance = parseInt(totalPoolBalanceBN.toString())
    var maxEthereumMinerFees = parseInt(maxEthereumMinerFeesBN.toString()); // TODO: BN.prototype.toNumber replacement
    
    var maxMinerFees = maxEthereumMinerFees / Math.pow(10, 18)
    var expectedAdditionalYearlyInterest = (bestPoolName != getCurrentPoolName()) ? totalPoolBalance * (bestApr - getCurrentApr()) : parseInt((await getFundControllerImmediateBalance()).toString()) * bestApr;

    expectedAdditionalYearlyInterest = expectedAdditionalYearlyInterest / Math.pow(10, 18);
    var expectedAdditionalYearlyInterestUsd = expectedAdditionalYearlyInterest * db.currencies["ETH"].usdRate;
    
    // Get seconds since last supply balancing (if we don't know the last time, assume it's been one week)
    var epoch = (new Date()).getTime() / 1000;

    var secondsSinceLastSupplyBalancing = db.currencies["ETH"].lastTimeBalanced > 0 ? epoch - db.currencies["ETH"].lastTimeBalanced : 86400 * 7;

    // Check AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD
    if (expectedAdditionalYearlyInterestUsd * (secondsSinceLastSupplyBalancing / 86400 / 365) / maxMinerFees < parseFloat(process.env.AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD)) {
        db.isBalancingSupply = false;
        console.log("Not balancing supply of ETH because", expectedAdditionalYearlyInterestUsd, "*", (secondsSinceLastSupplyBalancing / 86400 / 365), "/", maxMinerFees, "is less than", process.env.AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD);
        return;
    }

    console.log("Balancing supply of ETH because", expectedAdditionalYearlyInterestUsd, "*", (secondsSinceLastSupplyBalancing / 86400 / 365), "/", maxMinerFees, "is at least", process.env.AUTOMATIC_SUPPLY_BALANCING_MIN_ADDITIONAL_YEARLY_INTEREST_USD_TIMES_YEARS_SINCE_LAST_REBALANCING_PER_GAS_USD);

    // Balance supply!
    try {
        await doBalanceSupply(db, getCurrentPoolName(), bestPoolName, maxEthereumMinerFeesBN);
    } catch (error) {
        db.isBalancingSupply = false;
        console.error("Failed to balance supply of ETH:", error);
        return;
    }

    db.currencies["ETH"].lastTimeBalanced = epoch;

    db.isBalancingSupply = false;
}


async function getMaxEthereumMinerFeesForSupplyBalancing(currentPoolName, bestPoolName) {
    try {
        var gasPrice = await web3.eth.getGasPrice();
    } catch (error) {
        throw "Failed to check ETH gas price to calculate max Ethereum miner fees before balancing supply: " + error;
    }
    
    var gasNecessary = 0;

    if (currentPoolName == bestPoolName) gasNecessary = 250000;
    else gasNecessary = 500000;

    return web3.utils.toBN(gasNecessary).mul(web3.utils.toBN(gasPrice));
}


async function doBalanceSupply(db, currentPoolName, bestPoolName, maxEthereumMinerFeesBN = null) {
    console.log('\x1b[32m%s\x1b[0m', "Starting to balance supply of ETH from ", currentPoolName, " to ", bestPoolName);

    // Check that we have enough balance for gas fees
    try {
        var ethereumBalance = await web3.eth.getBalance(process.env.ETHEREUM_ADMIN_ACCOUNT);
    } catch (error) {
        throw "Failed to check ETH wallet balance to make sure we have enough funds for fees before balancing supply: " + error;
    }
    
    if (maxEthereumMinerFeesBN === null) {
        try {
            maxEthereumMinerFeesBN = await getMaxEthereumMinerFeesForSupplyBalancing(getCurrentPoolName(), bestPoolName);
        } catch (error) {
            throw "Failed to check max Ethereum miner fees before balancing supply: " + error;
        }
    }

    if (web3.utils.toBN(ethereumBalance).lt(maxEthereumMinerFeesBN)) throw "Not enough balance in ETH wallet to cover gas fees to balance supply!"; // TODO: Notify admin well before we run out of ETH for gas

    // Keep track of total balance difference

    var totalFundsBN = currentPoolName ? db.pools[currentPoolName].currencies["ETH"].poolBalanceBN : web3.utils.toBN(0);

    if (currentPoolName == bestPoolName) {
        // if there is ETH that has not been added to a pool, add it to the best pool and return
        try {
            var txid = await addFunds(bestPoolName, (await getFundControllerImmediateBalance()));
        } catch (error) {
            throw "Failed to add funds to pool when balancing supply of ETH: " + error;
        }
        return;
    }

    if (currentPoolName != null) {
	    try {
	        var txid = await removeFunds(currentPoolName, totalFundsBN, true); // remove all funds from current pool
	    } catch (error) {
	        throw "Failed to remove funds from pool " + currentPoolName + " when balancing supply of ETH: " + error;
	    }

    	db.pools[currentPoolName].currencies["ETH"].poolBalanceBN = web3.utils.toBN(0);
    }

    totalFundsBN = await getFundControllerImmediateBalance(); // whatever we withdrew from the current pool is in the current balance

    if (!totalFundsBN.eq(web3.utils.toBN(0))) {
        try {
            var txid = await addFunds(bestPoolName, totalFundsBN);
        } catch (error) {
            throw "Failed to add funds to pool when balancing supply of ETH: " + error;
        }
    }

    // Update pool's currency balance
    db.pools[bestPoolName].currencies["ETH"].poolBalanceBN = totalFundsBN;
}



async function approveWethToDydx(amountBN) {
    // Create depositToPool transaction
    var data = fundControllerContract.methods.approveWethToDydxPool(amountBN).encodeABI();

    // Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
        value: 0,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.log("Approving", amountBN.toString(), "WETH to dYdX:", tx);

    // Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending transaction for approveWeth of WETH to dYdX: " + error;
    }
    
    // Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing transaction for approveToPool of WETH to dYdX: " + error;
    }

    // Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending transaction for approveWeth of WETH to dYdX: " + error;
    }
    
    console.log("Successfully approved WETH funds to dYdX:", sentTx);
    return sentTx;
}



async function approvekEtherToKeeperDao(amountBN) {
    // Create depositToPool transaction
    var data = fundControllerContract.methods.approvekEtherToKeeperDaoPool(amountBN).encodeABI();

    // Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
        value: 0,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.log("Approving", amountBN.toString(), " funds to KeeperDAO:", tx);

    // Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending transaction for approvekEther of to KeeperDAO: " + error;
    }
    
    // Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing transaction for approveToPool of ETH to KeeperDAO: " + error;
    }

    // Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending transaction for approveToPool of ETH to KeeperDAO: " + error;
    }
    
    console.log("Successfully approved kEther to KeeperDAO:", sentTx);
    return sentTx;
}



async function addFunds(poolName, amountBN) {
    // Create depositToPool transaction
    var data = fundControllerContract.methods.depositToPool(db.pools[poolName].id, amountBN).encodeABI();

    // Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
        value: 0,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.log("Adding", amountBN.toString(), "ETH funds to", poolName, ":", tx);

    // Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending transaction for depositToPool of ETH to " + poolName + ": " + error;
    }
    
    // Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing transaction for depositToPool of ETH + to " + poolName + ": " + error;
    }

    // Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending transaction for depositToPool of ETH to " + poolName + ": " + error;
    }
    
    console.log("Successfully added ETH funds to", poolName, ":", sentTx);

    return sentTx;
}

async function removeFunds(poolName, amountBN, removeAll = false) {
    // Create withdrawFromPool transaction
    var data = (removeAll ? fundControllerContract.methods.withdrawAllFromPool(db.pools[poolName].id) : fundControllerContract.methods.withdrawFromPool(db.pools[poolName].id, amountBN)).encodeABI();

    // Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
        value: 0,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.log("Removing", removeAll ? "all of" : amountBN.toString(), " ETH from", poolName, ":", tx);

    // Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending transaction for " + (removeAll ? "withdrawAllFromPool" : "withdrawFromPool") + " of ETH from " + poolName + ": " + error;
    }
    
    // Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing transaction for " + (removeAll ? "withdrawAllFromPool" : "withdrawFromPool") + " of ETH from " + poolName + ": " + error;
    }

    // Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending transaction for " + (removeAll ? "withdrawAllFromPool" : "withdrawFromPool") + " of ETH from " + poolName + ": " + error;
    }
    
    console.log("Successfully removed", removeAll ? "all of" : amountBN.toString(), " ETH from", poolName, ":", sentTx);
    return sentTx;
}




async function approveFundsTo0x(currencyCode, amountBN) {
    // Create depositToPool transaction
    var data = fundControllerContract.methods.approveCompTo0x(amountBN).encodeABI();

    // Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
        value: 0,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.log("Approving", amountBN.toString(), currencyCode, "funds to 0x:", tx);

    // Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending transaction for approveTo0x of " + currencyCode + ": " + error;
    }
    
    // Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing transaction for approveTo0x of " + currencyCode + ": " + error;
    }

    // Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending transaction for approveTo0x of " + currencyCode + ": " + error;
    }
    
    console.log("Successfully approved", currencyCode, "funds to 0x:", sentTx);
    return sentTx;
}



async function exchangeFunds(inputCurrencyCode, outputCurrencyCode, takerAssetFillAmountBN, orders, protocolFeeBN, gasPriceBN) {
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
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.log("Exchanging up to", takerAssetFillAmountBN.toString(), inputCurrencyCode, "to", outputCurrencyCode, ":", tx);

    // Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending transaction for marketSell0xOrdersFillOrKill to exchange " + inputCurrencyCode + " to " + outputCurrencyCode + ": " + error;
    }
    
    // Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing transaction for marketSell0xOrdersFillOrKill to exchange " + inputCurrencyCode + " to " + outputCurrencyCode + ": " + error;
    }

    // Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending transaction for marketSell0xOrdersFillOrKill to exchange " + inputCurrencyCode + " to " + outputCurrencyCode + ": " + error;
    }
    
    console.log("Successfully exchanged", inputCurrencyCode, "to", outputCurrencyCode, ":", sentTx);
    return sentTx;
}


async function unwrapAllWeth() {
	// Create depositToPool transaction
    var data = fundControllerContract.methods.unwrapAllWeth().encodeABI();

    // Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS,
        value: 0,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.log("Unwrapping all WETH...", tx);

    // Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending transaction for unwrapping all WETH.";
    }
    
    // Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) { 
        throw "Error signing transaction for unwrapping all WETH";
    }

    // Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending transaction for unwrapping all WETH.";
    }
    
    console.log("Successfully unwrapped all WETH.", sentTx);
    return sentTx;
}


async function checkPoolBalances() {
    // Get balances for all pools
    for (const poolName of Object.keys(db.pools)) {
        try {
            if (poolName === "dYdX") {
                // Might as well get all dYdX balances since it doesn't cost us anything
                db.pools[poolName].currencies["ETH"].poolBalanceBN = await dydxProtocol.getUnderlyingBalance();
            } else if (poolName === "Compound") {
                try {
                    db.pools[poolName].currencies["ETH"].poolBalanceBN = await compoundProtocol.getUnderlyingBalance();
                } catch (error) {
                    console.error("Failed to get ETH balance on Compound:", error);
                }
            } else if (poolName === "KeeperDAO") {
            	db.pools[poolName].currencies["ETH"].poolBalanceBN = await keeperDaoProtocol.getUnderlyingBalance();
            } else if (poolName === "Aave") {
            	db.pools[poolName].currencies["ETH"].poolBalanceBN = await aaveProtocol.getUnderlyingBalance();
            } else {
            	console.error("Unrecognized pool name: ", poolName);
            }
        } catch (error) {
            console.error("Failed to get balance of ETH for ", poolName, " pool:", error);
        }

        console.log(poolName, " getUnderlyingBalance: ", db.pools[poolName].currencies["ETH"].poolBalanceBN.toString());
    }
}


async function getFundControllerImmediateBalance() {
    const contractBalance = await web3.eth.getBalance(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS);
    return web3.utils.toBN(contractBalance);
}
