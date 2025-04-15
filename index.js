require("dotenv").config();
const Web3 = require("web3");
const axios = require("axios");

const web3 = new Web3(`https://sepolia.infura.io/v3/${process.env.INFURA_PROJECT_ID}`);
const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
const direccionEmpresa = process.env.EMPRESA_WALLET;
const clavePrivada = process.env.EMPRESA_PRIVATE_KEY;
const contratoAddress = process.env.CONTRATO_TOKEN;
const abi = require("./abi.json");

const contratoRB = new web3.eth.Contract(abi, contratoAddress);

// 🚨 CONFIGURA AQUÍ EL ENDPOINT DE TU WEB WORDPRESS:
const urlReserva = "https://renewbit.cl/wp-json/api-reservar-inversion/";
const urlRegistro = "https://renewbit.cl/wp-json/api/registrar-inversion/";

let ultimoBloque = 0;

async function obtenerTransacciones() {
  try {
    const { data } = await axios.get(`https://api-sepolia.etherscan.io/api`, {
      params: {
        module: "account",
        action: "txlist",
        address: direccionEmpresa,
        startblock: ultimoBloque,
        sort: "asc",
        apikey: etherscanApiKey
      }
    });

    const transacciones = data.result.filter(tx => tx.to?.toLowerCase() === direccionEmpresa.toLowerCase());

    for (const tx of transacciones) {
      if (parseInt(tx.value) === 0 || tx.isError !== "0") continue;

      const wallet = tx.from.toLowerCase();
      const valorETH = web3.utils.fromWei(tx.value, "ether");
      const tokensComprados = Math.floor(parseFloat(valorETH) / 0.001);

      console.log(`✔ Pago detectado: ${tokensComprados} tokens desde ${wallet}`);

      // Verificar reserva
      const reserva = await axios.get(`${urlReserva}?wallet=${wallet}`);
      const datosReserva = reserva.data;

      if (
        !datosReserva ||
        !datosReserva.tokens ||
        !datosReserva.proyecto_id ||
        parseInt(datosReserva.tokens) !== tokensComprados
      ) {
        console.warn(`⚠️ No se encontró reserva válida para ${wallet} o los tokens no coinciden. Transacción ignorada.`);
        continue;
      }

      // Enviar tokens
      const cuenta = web3.eth.accounts.privateKeyToAccount(clavePrivada);
      const txData = contratoRB.methods.transfer(wallet, tokensComprados).encodeABI();

      const gas = await web3.eth.estimateGas({
        from: cuenta.address,
        to: contratoAddress,
        data: txData
      });

      const tx = {
        from: cuenta.address,
        to: contratoAddress,
        data: txData,
        gas
      };

      const signedTx = await web3.eth.accounts.signTransaction(tx, clavePrivada);
      const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
      console.log(`✔ Tokens enviados: TX ${receipt.transactionHash}`);

      // Registrar inversión en WordPress
      const registrar = await axios.post(urlRegistro, {
        wallet,
        tokens: tokensComprados,
        proyecto_id: parseInt(datosReserva.proyecto_id),
        metodo_pago: "MetaMask",
        tx_hash: receipt.transactionHash
      });

      if (registrar.data.success) {
        console.log("✅ Inversión registrada en WordPress.");
      } else {
        console.error("❌ Error al registrar inversión:", registrar.data);
      }
    }

    if (transacciones.length > 0) {
      ultimoBloque = Math.max(...transacciones.map(tx => parseInt(tx.blockNumber))) + 1;
    }
  } catch (error) {
    console.error("❌ Error en el proceso:", error.message || error);
  }
}

setInterval(obtenerTransacciones, 15000); // cada 15 segundos
