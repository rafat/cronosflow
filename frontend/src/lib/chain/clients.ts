import "server-only";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { cronosTestnet } from "./config";

const rpcUrl = process.env.RPC_URL;
if (!rpcUrl) throw new Error("RPC_URL missing");

const pk = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) throw new Error("AGENT_PRIVATE_KEY missing");

export const agentAccount = privateKeyToAccount(pk);

export const publicClient = createPublicClient({
  chain: cronosTestnet,
  transport: http(rpcUrl),
});

export const walletClient = createWalletClient({
  chain: cronosTestnet,
  account: agentAccount,
  transport: http(rpcUrl),
});