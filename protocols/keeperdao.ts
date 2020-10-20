import fs from 'fs';
import Web3 from 'web3';

const IKTokenAbi = JSON.parse(fs.readFileSync(__dirname + '/keeperdao/IKToken.json', 'utf8'));
const ILiquidityPoolAbi = JSON.parse(fs.readFileSync(__dirname + '/keeperdao/ILiquidityPool.json', 'utf8'));

const WEB3_HISTORICAL_PROVIDER = "https://api.infura.io/v1/jsonrpc/mainnet";

export default class KeeperDaoProtocol {
    web3: Web3;
    web3Historical: Web3;
    keeperDaoContract: any;
    kEtherContact: any;
    lastSavedTimestamp: any;
    lastSavedExchangeRate: any; // BigNumber

    constructor(web3: Web3) {
        this.web3 = web3;
        this.web3Historical = new Web3(new Web3.providers.HttpProvider(WEB3_HISTORICAL_PROVIDER));
        this.kEtherContact = new this.web3Historical.eth.Contract(IKTokenAbi, "0xC4c43C78fb32F2c7F8417AF5af3B85f090F1d327");
        this.keeperDaoContract = new this.web3Historical.eth.Contract(ILiquidityPoolAbi, "0xEB7e15B4E38CbEE57a98204D05999C3230d36348");
    }


    calculateApy(startTimestamp, startExchangeRate, endTimestamp, endExchangeRate) {
        const SECONDS_PER_YEAR = 365 * 86400;
        var timeDiff = endTimestamp - startTimestamp;
        return ((endExchangeRate.toString() / startExchangeRate.toString()) ** (SECONDS_PER_YEAR / timeDiff)) - 1;
    }


    async getApr() {
        const exchangeRateNow = await this.getExchangeRate();
        return this.calculateApy(this.lastSavedTimestamp, this.lastSavedExchangeRate, (new Date()).getTime() / 1000, exchangeRateNow);
    }


    async getUnderlyingBalance() {
        var underlyingBalance = null;
        try {
            underlyingBalance = await this.keeperDaoContract.methods.underlyingBalance("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS).call();
        } catch (error) {
            console.log("Error on getting underlying balance for KeeperDAO... ", error);
        }
        console.log("underlyingBalance: ", underlyingBalance)
        return this.web3.utils.toBN(underlyingBalance);
    }
    

    async getExchangeRate(offset = 0) {
        const currentBlockNumber = await this.web3.eth.getBlockNumber();
        const borrowableBalance = await this.keeperDaoContract.methods.borrowableBalance("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE").call(null, currentBlockNumber - offset);
        const totalkEtherSupply = await this.kEtherContact.methods.totalSupply().call(null, currentBlockNumber - offset);
        return borrowableBalance / totalkEtherSupply;
    }

    valueToBN({ value, sign }: { value: string, sign: boolean }) {
        let result = this.web3.utils.toBN(value);
        if (!result.isZero() && !sign) result.imul(this.web3.utils.toBN(-1));
        return result;
    }
    
}
