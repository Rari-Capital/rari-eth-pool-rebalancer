import fs from 'fs';
import Web3 from 'web3';

const aTokenAbi = JSON.parse(fs.readFileSync(__dirname + '/aave/AToken.json', 'utf8'));
const lendingPoolAbi = JSON.parse(fs.readFileSync(__dirname + '/aave/LendingPool.json', 'utf8'));
const lendingPoolCoreAbi = JSON.parse(fs.readFileSync(__dirname + '/aave/LendingPoolCore.json', 'utf8'));
const iReserveInterestRateStrategyAbi = JSON.parse(fs.readFileSync(__dirname + '/aave/IReserveInterestRateStrategy.json', 'utf8'));

export default class AaveProtocol {
    web3: Web3;
    

    aTokenContracts = {
        "ETH": "0x3a3A65aAb0dd2A17E3F1947bA16138cd37d08c04"
    };

    ethReserve = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    lendingPoolContract = "0x398ec7346dcd622edc5ae82352f02be94c62d119";
    lendingPoolCoreContract = "0x3dfd23a6c5e8bbcfc9581d2e864a68feb6a076d3";

    constructor(web3: Web3) {
        this.web3 = web3;
    }

    async predictApr(currencyCode, supplyWeiDifferenceBN) {
        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var lendingPoolContract = new this.web3.eth.Contract(lendingPoolAbi, this.lendingPoolContract);

        try {
            var reserveData = await lendingPoolContract.methods.getReserveData(this.ethReserve).call();
        } catch (error) {
            throw "Error when getting Aave reserve data of " + this.ethReserve + ": " + error;
        }

        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var lendingPoolCoreContract = new this.web3.eth.Contract(lendingPoolCoreAbi, this.lendingPoolCoreContract);

        try {
            var reserveInterestRateStrategyAddress = await lendingPoolCoreContract.methods.getReserveInterestRateStrategyAddress(this.ethReserve).call();
        } catch (error) {
            throw "Error when getting Aave ReserveInterestRateStrategyAddress of ETH: " + error;
        }

        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var iReserveInterestRateStrategyContract = new this.web3.eth.Contract(iReserveInterestRateStrategyAbi, reserveInterestRateStrategyAddress);

        try {
            var interestRates = await iReserveInterestRateStrategyContract.methods.calculateInterestRates(
                this.ethReserve,
                Web3.utils.toBN(reserveData.availableLiquidity).add(supplyWeiDifferenceBN.gt(Web3.utils.toBN(0)) ? supplyWeiDifferenceBN : Web3.utils.toBN(0)).sub(supplyWeiDifferenceBN.isNeg() ? supplyWeiDifferenceBN.abs() : Web3.utils.toBN(0)),
                reserveData.totalBorrowsStable,
                reserveData.totalBorrowsVariable,
                reserveData.currentAverageStableBorrowRate
            ).call();
        } catch (error) {
            throw "Error when getting Aave ReserveInterestRateStrategy.calculateInterestRates on " + this.ethReserve + ": " + error;
        }
        
        return parseFloat(this.web3.utils.toBN(interestRates.liquidityRate).div(this.web3.utils.toBN(1e9)).toString()) / 1e18;
    }

    async getApr() {
        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var lendingPoolCoreContract = new this.web3.eth.Contract(lendingPoolCoreAbi, this.lendingPoolCoreContract);

        try {
            var apyRay = await lendingPoolCoreContract.methods.getReserveCurrentLiquidityRate(this.ethReserve).call();
        } catch (error) {
            throw "Error when checking Aave APY of ETH: " + error;
        }

        return parseFloat(this.web3.utils.toBN(apyRay).div(this.web3.utils.toBN(1e9)).toString()) / 1e18;
    }

    async getUnderlyingBalance() {
        // TODO: Remove @ts-ignore below
        // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
        var aTokenContract = new this.web3.eth.Contract(aTokenAbi, this.aTokenContracts["ETH"]);
        
        try {
            var balanceOfUnderlying = await aTokenContract.methods.balanceOf(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS).call();
        } catch (error) {
            throw "Error when checking underlying Aave balance of ETH: " + error;
        }

        if (process.env.NODE_ENV !== "production") console.log("AaveProtocol.getUnderlyingBalance got", balanceOfUnderlying, "ETH");
        return this.web3.utils.toBN(balanceOfUnderlying);
    }

}