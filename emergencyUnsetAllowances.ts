const Web3 = require('web3');
const assert = require('assert');

import DydxProtocol from './protocols/dydx';
import CompoundProtocol from './protocols/compound';

const rariFundControllerAbi = require('./abi/RariFundController.json');

// Init Web3
var web3 = new Web3(new Web3.providers.HttpProvider(process.env.INFURA_ENDPOINT_URL));


if (process.argv[2] === "0x") {
    unsetCompAllowanceTo0x();
}

async function unsetCompAllowanceTo0x() {
    console.log("Setting zero token allowance for COMP on 0x");

    try {
        var txid = await approveCompTo0x(web3.utils.toBN(0));
    } catch (error) {
        console.log("Failed to set zero token allowance for COMP on 0x");
    }
    
    console.log("Zero token allowance set successfully for COMP on 0x:", txid);
}

async function approveCompTo0x(amountBN) {
    var fundControllerContract = new web3.eth.Contract(rariFundControllerAbi, process.env.ETHEREUM_FUND_CONTROLLER_CONTRACT_ADDRESS);

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

    if (process.env.NODE_ENV !== "production") console.log("Approving", amountBN.toString(), "COMP funds to 0x:", tx);

    // Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending transaction for approveTo0x of COMP: " + error;
    }
    
    // Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing transaction for approveTo0x of COMP: " + error;
    }

    // Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending transaction for approveTo0x of COMP: " + error;
    }
    
    console.log("Successfully approved COMP funds to 0x:", sentTx);
    return sentTx;
}
