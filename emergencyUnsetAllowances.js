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
Object.defineProperty(exports, "__esModule", { value: true });
const Web3 = require('web3');
const assert = require('assert');
const rariFundControllerAbi = require('./abi/RariFundController.json');
// Init Web3
var web3 = new Web3(new Web3.providers.HttpProvider(process.env.INFURA_ENDPOINT_URL));
if (process.argv[2] === "0x") {
    unsetCompAllowanceTo0x();
}
function unsetCompAllowanceTo0x() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Setting zero token allowance for COMP on 0x");
        try {
            var txid = yield approveCompTo0x(web3.utils.toBN(0));
        }
        catch (error) {
            console.log("Failed to set zero token allowance for COMP on 0x");
        }
        console.log("Zero token allowance set successfully for COMP on 0x:", txid);
    });
}
function approveCompTo0x(amountBN) {
    return __awaiter(this, void 0, void 0, function* () {
        var fundControllerContract = new web3.eth.Contract(rariFundControllerAbi, process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS);
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
            console.log("Approving", amountBN.toString(), "COMP funds to 0x:", tx);
        // Estimate gas for transaction
        try {
            tx["gas"] = yield web3.eth.estimateGas(tx);
        }
        catch (error) {
            throw "Failed to estimate gas before signing and sending transaction for approveTo0x of COMP: " + error;
        }
        // Sign transaction
        try {
            var signedTx = yield web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        }
        catch (error) {
            throw "Error signing transaction for approveTo0x of COMP: " + error;
        }
        // Send transaction
        try {
            var sentTx = yield web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        }
        catch (error) {
            throw "Error sending transaction for approveTo0x of COMP: " + error;
        }
        console.log("Successfully approved COMP funds to 0x:", sentTx);
        return sentTx;
    });
}
//# sourceMappingURL=emergencyUnsetAllowances.js.map