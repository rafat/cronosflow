import "server-only";
import { createPublicClient, createWalletClient, http, PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { cronosTestnet } from "./config";

const rpcUrl = process.env.RPC_URL;
if (!rpcUrl) throw new Error("RPC_URL missing");

const pk = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;

let agentAccount: PrivateKeyAccount | undefined;
if (pk) {
    try {
        agentAccount = privateKeyToAccount(pk);
    } catch (e) {
        // During build, private key might be invalid. We can ignore this.
        // At runtime, the check in write/deploy will catch it.
        console.warn("Could not create agent account from private key. Likely invalid during build.");
    }
}

export const publicClient = createPublicClient({
  chain: cronosTestnet,
  transport: http(rpcUrl),
});

export const walletClient = (agentAccount) ? createWalletClient({
  chain: cronosTestnet,
  account: agentAccount,
  transport: http(rpcUrl),
}) : undefined;

export function getAgentAddress(): `0x${string}` | undefined {
  return agentAccount?.address;
}