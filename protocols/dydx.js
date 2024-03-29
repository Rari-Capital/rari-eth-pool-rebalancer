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
const soloMarginAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/dydx/SoloMargin.json', 'utf8'));
const polynomialInterestSetterAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/dydx/PolynomialInterestSetter.json', 'utf8'));
class DydxProtocol {
    constructor(web3) {
        this.marketIds = { "WETH": 0 };
        this.web3 = web3;
        this.soloMarginContract = new this.web3.eth.Contract(soloMarginAbi, "0x1e0447b19bb6ecfdae1e4ae1694b0c3659614e4e");
    }
    parToWei(parBN, indexBN) {
        return parBN.mul(indexBN);
    }
    weiToPar(weiBN, indexBN) {
        return weiBN.div(indexBN);
    }
    predictApr(tokenAddress, supplyWeiDifferenceBN) {
        return __awaiter(this, void 0, void 0, function* () {
            var marketId = this.marketIds["WETH"];
            if (marketId === undefined)
                throw "Currency code not supported by dYdX implementation";
            try {
                var res = yield this.soloMarginContract.methods.getMarketTotalPar(marketId).call();
                var borrowParBN = this.web3.utils.toBN(res[0]);
                var supplyParBN = this.web3.utils.toBN(res[1]);
            }
            catch (error) {
                throw "Error when calling SoloMargin.getMarketTotalPar for WETH: " + error;
            }
            try {
                var res = yield this.soloMarginContract.methods.getMarketCurrentIndex(marketId).call();
                var borrowIndexBN = this.web3.utils.toBN(res[0]);
                var supplyIndexBN = this.web3.utils.toBN(res[1]);
            }
            catch (error) {
                throw "Error when calling SoloMargin.getMarketCurrentIndex for WETH: " + error;
            }
            var borrowWeiBN = this.parToWei(borrowParBN, borrowIndexBN);
            var supplyWeiBN = this.parToWei(supplyParBN, supplyIndexBN);
            var newSupplyWeiBN = supplyWeiBN.add(supplyWeiDifferenceBN);
            var polynomialInterestSetterContract = new this.web3.eth.Contract(polynomialInterestSetterAbi, "0xaEE83ca85Ad63DFA04993adcd76CB2B3589eCa49");
            try {
                var borrowInterestRatePerSecondBN = this.web3.utils.toBN((yield polynomialInterestSetterContract.methods.getInterestRate(tokenAddress, borrowWeiBN, newSupplyWeiBN).call())[0]);
            }
            catch (error) {
                throw "Error when calling PolynomialInterestSetter.getInterestRate for WETH: " + error;
            }
            var secondsPerYearBN = this.web3.utils.toBN(60 * 60 * 24 * 365);
            var borrowInterestRatePerYearBN = borrowInterestRatePerSecondBN.mul(secondsPerYearBN);
            var earningsRateBN = this.web3.utils.toBN("950000000000000000");
            return parseFloat(borrowInterestRatePerYearBN.mul(earningsRateBN).mul(borrowWeiBN).div(supplyWeiBN).div(this.web3.utils.toBN(1e18)).toString()) / 1e18; // borrowWeiBN.div(supplyWeiBN) = utilization/usage
        });
    }
    getApr() {
        return __awaiter(this, void 0, void 0, function* () {
            var marketId = this.marketIds["WETH"];
            if (marketId === undefined)
                throw "Currency code not supported by dYdX implementation";
            try {
                var borrowInterestRatePerSecondBN = this.web3.utils.toBN((yield this.soloMarginContract.methods.getMarketInterestRate(marketId).call())[0]);
            }
            catch (error) {
                throw "Error when calling SoloMargin.getMarketInterestRate for " + "WETH" + ": " + error;
            }
            try {
                var res = yield this.soloMarginContract.methods.getMarketTotalPar(marketId).call();
                var borrowParBN = this.web3.utils.toBN(res[0]);
                var supplyParBN = this.web3.utils.toBN(res[1]);
            }
            catch (error) {
                throw "Error when calling SoloMargin.getMarketTotalPar for " + "WETH" + ": " + error;
            }
            try {
                var res = yield this.soloMarginContract.methods.getMarketCurrentIndex(marketId).call();
                var borrowIndexBN = this.web3.utils.toBN(res[0]);
                var supplyIndexBN = this.web3.utils.toBN(res[1]);
            }
            catch (error) {
                throw "Error when calling SoloMargin.getMarketCurrentIndex for " + "WETH" + ": " + error;
            }
            var secondsPerYearBN = this.web3.utils.toBN(60 * 60 * 24 * 365);
            var borrowInterestRatePerYearBN = borrowInterestRatePerSecondBN.mul(secondsPerYearBN);
            var borrowWeiBN = this.parToWei(borrowParBN, borrowIndexBN);
            var supplyWeiBN = this.parToWei(supplyParBN, supplyIndexBN);
            var earningsRateBN = this.web3.utils.toBN("950000000000000000");
            return parseFloat(borrowInterestRatePerYearBN.mul(earningsRateBN).mul(borrowWeiBN).div(supplyWeiBN).div(this.web3.utils.toBN(1e18)).toString()) / 1e18; // borrowWeiBN.div(supplyWeiBN) = utilization/usage
        });
    }
    getUnderlyingBalance() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                var [tokens, pars, weis] = Object.values(yield this.soloMarginContract.methods.getAccountBalances({
                    owner: process.env.ETHEREUM_FUND_MANAGER_CONTRACT_ADDRESS,
                    number: this.web3.utils.toBN(0)
                }).call());
            }
            catch (error) {
                throw "Error when calling SoloMargin.getAccountBalances: " + error;
            }
            if (process.env.NODE_ENV !== "production")
                console.log("DydxProtocol.getUnderlyingBalances got", weis);
            return this.valueToBN(weis[this.marketIds["WETH"]]);
        });
    }
    valueToBN({ value, sign }) {
        let result = this.web3.utils.toBN(value);
        if (!result.isZero() && !sign)
            result.imul(this.web3.utils.toBN(-1));
        return result;
    }
}
exports.default = DydxProtocol;
//# sourceMappingURL=dydx.js.map