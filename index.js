require('dotenv').config();
const Web3 = require('web3');
const axios = require('axios');
const fs = require('fs');
const { walletEmpresa, contratoRB, redRPC, apiUrlWordpress } = require('./config/config');
const ABI = require('./config/abi.json');

const web3 = new Web3(new Web3.providers.HttpProvider(redRPC));
const contract = new web3.eth.Contract(ABI, contratoRB);

async function verificarTransacciones() {
  const apiKey = process.env.API_KEY_ETHERSCAN;
  const url = `https://api-sepolia.etherscan.io/api?module=account&action=txlist&address=${walletEmpresa}&sort=desc&apikey=${apiKey}`;
  const response = await axios.get(url);
  const transacciones = response.data.result;

  for (const tx of transacciones) {
    if (tx.to.toLowerCase() === walletEmpresa.toLowerCase() && tx.value > 0 && tx.isError === "0") {
      const walletCliente = tx.from;
      const txHash = tx.hash;
      const montoETH = parseFloat(web3.utils.fromWei(tx.value, 'ether'));
      const tokens = Math.floor(montoETH / 0.001);
      const yaProcesado = fs.existsSync(`logs/${txHash}.json`);
      if (yaProcesado) continue;

      console.log(`✔ Pago detectado: ${tokens} tokens desde ${walletCliente}`);

      try {
        const decimals = await contract.methods.decimals().call();
        const cantidad = BigInt(tokens) * BigInt(10) ** BigInt(decimals);

        const gasPrice = await web3.eth.getGasPrice();
        const adjustedGasPrice = web3.utils.toBN(gasPrice).add(web3.utils.toBN(web3.utils.toWei('2', 'gwei')));
        const nonce = await web3.eth.getTransactionCount(walletEmpresa, "pending");

        const signedTx = await web3.eth.accounts.signTransaction({
          to: contratoRB,
          data: contract.methods.transfer(walletCliente, cantidad).encodeABI(),
          gas: 100000,
          gasPrice: adjustedGasPrice.toString(),
          nonce
        }, process.env.PRIVATE_KEY);

        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        console.log(`✔ Tokens enviados: TX ${receipt.transactionHash}`);

        // Registrar en WordPress
        await axios.post(apiUrlWordpress, {
          wallet: walletCliente,
          tokens: tokens,
          tx_hash: txHash,
          proyecto_id: 0
        });

        fs.writeFileSync(`logs/${txHash}.json`, JSON.stringify({ status: "procesado", txHash, walletCliente }));
      } catch (err) {
        console.error("❌ Error al enviar tokens o registrar inversión:", err.message);
      }
    }
  }
}

verificarTransacciones();
