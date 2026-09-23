import dotenv from "dotenv";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";

dotenv.config();

export default {
  plugins: [hardhatEthers, hardhatMocha],
  solidity: "0.8.20",
  networks: {
    // Local Hardhat node for rapid testing
    hardhat: {
      type: "edr-simulated",
    },
    
    // Polygon Amoy Public Testnet
    polygonAmoy: {
      type: "http",
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 80002,
    },

    // Local persistent node for API integration (npx hardhat node)
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
};
