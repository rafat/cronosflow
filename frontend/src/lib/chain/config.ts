import { defineChain } from "viem";

export const cronosTestnet = defineChain({
  id: Number(process.env.CHAIN_ID ?? 338),
  name: "Cronos Testnet",
  nativeCurrency: { name: "tCRO", symbol: "tCRO", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL!] },
    public: { http: [process.env.RPC_URL!] },
  },
  blockExplorers: {
    default: { name: "CronosScan", url: "https://testnet.cronoscan.com" },
  },
});