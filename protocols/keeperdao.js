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
const IKTokenAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/keeperdao/IKToken.json', 'utf8'));
const ILiquidityPoolAbi = JSON.parse(fs_1.default.readFileSync(__dirname + '/keeperdao/ILiquidityPool.json', 'utf8'));
const WEB3_HISTORICAL_PROVIDER = "https://api.infura.io/v1/jsonrpc/mainnet";
class KeeperDaoProtocol {
    constructor(web3) {
        this.web3 = web3;
        this.web3Historical = new web3_1.default(new web3_1.default.providers.HttpProvider(WEB3_HISTORICAL_PROVIDER));
        this.kEtherContact = new this.web3Historical.eth.Contract(IKTokenAbi, "0xC4c43C78fb32F2c7F8417AF5af3B85f090F1d327");
        this.keeperDaoContract = new this.web3Historical.eth.Contract(ILiquidityPoolAbi, "0xEB7e15B4E38CbEE57a98204D05999C3230d36348");
    }
    calculateApy(startTimestamp, startExchangeRate, endTimestamp, endExchangeRate) {
        const SECONDS_PER_YEAR = 365 * 86400;
        var timeDiff = endTimestamp - startTimestamp;
        return (Math.pow((endExchangeRate.toString() / startExchangeRate.toString()), (SECONDS_PER_YEAR / timeDiff))) - 1;
    }
    getApr() {
        return __awaiter(this, void 0, void 0, function* () {
            const exchangeRateNow = yield this.getExchangeRate();
            console.log("exchangeRateNow: ", exchangeRateNow);
            console.log("lastSavedExchangeRate: ", this.lastSavedExchangeRate);
            console.log("now: ", (new Date()).getTime() / 1000);
            console.log("lastSavedTimestamp: ", this.lastSavedTimestamp);
            return this.calculateApy(this.lastSavedTimestamp, this.lastSavedExchangeRate, (new Date()).getTime() / 1000, exchangeRateNow);
        });
    }
    getUnderlyingBalance() {
        return __awaiter(this, void 0, void 0, function* () {
            var underlyingBalance = null;
            try {
                underlyingBalance = yield this.keeperDaoContract.methods.underlyingBalance("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS).call();
            }
            catch (error) {
                console.log("Error on getting underlying balance for KeeperDAO... ", error);
            }
            console.log("underlyingBalance: ", underlyingBalance);
            return this.web3.utils.toBN(underlyingBalance);
        });
    }
    getExchangeRate(offset = 0) {
        return __awaiter(this, void 0, void 0, function* () {
            const currentBlockNumber = yield this.web3.eth.getBlockNumber();
            const borrowableBalance = yield this.keeperDaoContract.methods.borrowableBalance("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE").call(null, currentBlockNumber - offset);
            const totalkEtherSupply = yield this.kEtherContact.methods.totalSupply().call(null, currentBlockNumber - offset);
            return borrowableBalance / totalkEtherSupply;
        });
    }
    valueToBN({ value, sign }) {
        let result = this.web3.utils.toBN(value);
        if (!result.isZero() && !sign)
            result.imul(this.web3.utils.toBN(-1));
        return result;
    }
}
exports.default = KeeperDaoProtocol;
//# sourceMappingURL=keeperdao.js.map