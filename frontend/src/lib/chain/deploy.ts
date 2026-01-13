import "server-only";
import { publicClient, walletClient } from "./clients";

export async function deployContract<TArgs extends any[]>({
  abi,
  bytecode,
  args,
}: {
  abi: any;
  bytecode: `0x${string}`;
  args?: TArgs;
}) {
  if (!walletClient) {
    throw new Error("Wallet client is not available. Check AGENT_PRIVATE_KEY environment variable.");
  }
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: (args ?? []) as any,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("Deploy failed: no contractAddress");

  return { address: receipt.contractAddress as `0x${string}`, hash };
}