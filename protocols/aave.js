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
const aTokenAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/aave/AToken.json', 'utf8'));
const lendingPoolAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/aave/LendingPool.json', 'utf8'));
const lendingPoolCoreAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/aave/LendingPoolCore.json', 'utf8'));
const iReserveInterestRateStrategyAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/aave/IReserveInterestRateStrategy.json', 'utf8'));
class AaveProtocol {
    constructor(web3) {
        this.aTokenContracts = {
            "ETH": "0x3a3A65aAb0dd2A17E3F1947bA16138cd37d08c04"
        };
        this.ethReserve = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
        this.lendingPoolContract = "0x398ec7346dcd622edc5ae82352f02be94c62d119";
        this.lendingPoolCoreContract = "0x3dfd23a6c5e8bbcfc9581d2e864a68feb6a076d3";
        this.web3 = web3;
    }
    predictApr(currencyCode, supplyWeiDifferenceBN) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: Remove @ts-ignore below
            // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
            var lendingPoolContract = new this.web3.eth.Contract(lendingPoolAbi, this.lendingPoolContract);
            try {
                var reserveData = yield lendingPoolContract.methods.getReserveData(this.ethReserve).call();
            }
            catch (error) {
                throw "Error when getting Aave reserve data of " + this.ethReserve + ": " + error;
            }
            // TODO: Remove @ts-ignore below
            // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
            var lendingPoolCoreContract = new this.web3.eth.Contract(lendingPoolCoreAbi, this.lendingPoolCoreContract);
            try {
                var reserveInterestRateStrategyAddress = yield lendingPoolCoreContract.methods.getReserveInterestRateStrategyAddress(this.ethReserve).call();
            }
            catch (error) {
                throw "Error when getting Aave ReserveInterestRateStrategyAddress of ETH: " + error;
            }
            // TODO: Remove @ts-ignore below
            // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
            var iReserveInterestRateStrategyContract = new this.web3.eth.Contract(iReserveInterestRateStrategyAbi, reserveInterestRateStrategyAddress);
            try {
                var interestRates = yield iReserveInterestRateStrategyContract.methods.calculateInterestRates(this.ethReserve, web3_1.default.utils.toBN(reserveData.availableLiquidity).add(supplyWeiDifferenceBN.gt(web3_1.default.utils.toBN(0)) ? supplyWeiDifferenceBN : web3_1.default.utils.toBN(0)).sub(supplyWeiDifferenceBN.isNeg() ? supplyWeiDifferenceBN.abs() : web3_1.default.utils.toBN(0)), reserveData.totalBorrowsStable, reserveData.totalBorrowsVariable, reserveData.currentAverageStableBorrowRate).call();
            }
            catch (error) {
                throw "Error when getting Aave ReserveInterestRateStrategy.calculateInterestRates on " + this.ethReserve + ": " + error;
            }
            return parseFloat(this.web3.utils.toBN(interestRates.liquidityRate).div(this.web3.utils.toBN(1e9)).toString()) / 1e18;
        });
    }
    getApr() {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: Remove @ts-ignore below
            // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
            var lendingPoolCoreContract = new this.web3.eth.Contract(lendingPoolCoreAbi, this.lendingPoolCoreContract);
            try {
                var apyRay = yield lendingPoolCoreContract.methods.getReserveCurrentLiquidityRate(this.ethReserve).call();
            }
            catch (error) {
                throw "Error when checking Aave APY of ETH: " + error;
            }
            return parseFloat(this.web3.utils.toBN(apyRay).div(this.web3.utils.toBN(1e9)).toString()) / 1e18;
        });
    }
    getUnderlyingBalance() {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: Remove @ts-ignore below
            // @ts-ignore: Argument of type [...] is not assignable to parameter of type 'AbiItem | AbiItem[]'.
            var aTokenContract = new this.web3.eth.Contract(aTokenAbi, this.aTokenContracts["ETH"]);
            try {
                var balanceOfUnderlying = yield aTokenContract.methods.balanceOf(process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS).call();
            }
            catch (error) {
                throw "Error when checking underlying Aave balance of ETH: " + error;
            }
            if (process.env.NODE_ENV !== "production")
                console.log("AaveProtocol.getUnderlyingBalance got", balanceOfUnderlying, "ETH");
            return this.web3.utils.toBN(balanceOfUnderlying);
        });
    }
}
exports.default = AaveProtocol;
//# sourceMappingURL=aave.js.map