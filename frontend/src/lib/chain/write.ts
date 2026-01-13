import "server-only";
import { walletClient, publicClient } from "./clients";
import { Registry, Vault, RentalLogic } from "@/src/lib/contracts";

export async function txCheckAndTriggerDefault(registry: `0x${string}`, assetId: bigint) {
  if (!walletClient) {
    throw new Error("Wallet client is not available. Check AGENT_PRIVATE_KEY environment variable.");
  }
  const hash = await walletClient.writeContract({
    address: registry,
    abi: Registry.abi,
    functionName: "checkAndTriggerDefault",
    args: [assetId],
  });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, rcpt };
}

export async function txCommitDistribution(
  vault: `0x${string}`,
  amount: bigint,
) {
  if (!walletClient) {
    throw new Error("Wallet client is not available. Check AGENT_PRIVATE_KEY environment variable.");
  }
  const hash = await walletClient.writeContract({
    address: vault,
    abi: Vault.abi,
    functionName: "commitToDistribution",
    args: [amount],
  });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, rcpt };
}

// Demo-only: let operator simulate a tenant paying into the vault, then
// inform logic, then commit distribution, all in one flow.
export async function txSimulatePaymentAndDistribution(params: {
  vault: `0x${string}`;
  logic: `0x${string}`;
  registry: `0x${string}`;
  assetId: bigint;
  from: `0x${string}`;
  amount: bigint;
}) {
  if (!walletClient) {
    throw new Error("Wallet client is not available. Check AGENT_PRIVATE_KEY environment variable.");
  }
  const { vault, logic, registry, assetId, from, amount } = params;

  // 1) depositRevenue(from, amount)
  const depHash = await walletClient.writeContract({
    address: vault,
    abi: Vault.abi,
    functionName: "depositRevenue",
    args: [from, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: depHash });

  // 2) logic.processPayment(amount, now) – logic is open to anyone, but we use operator
  const now = BigInt(Math.floor(Date.now() / 1000));
  const lpHash = await walletClient.writeContract({
    address: logic,
    abi: RentalLogic.abi,
    functionName: "processPayment",
    args: [amount, now],
  });
  await publicClient.waitForTransactionReceipt({ hash: lpHash });

  // 3) registry.recordPayment(assetId, amount) – better registry accounting (if roles set)
  let recordHash: `0x${string}` | undefined;
  try {
    recordHash = await walletClient.writeContract({
      address: registry,
      abi: Registry.abi,
      functionName: "recordPayment",
      args: [assetId, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: recordHash });
  } catch {
    // ignore if operator does not have PAYMENT_COLLECTOR_ROLE
  }

  // 4) commitToDistribution(amount) – you may want to pass expected from schedule instead
  const cdHash = await walletClient.writeContract({
    address: vault,
    abi: Vault.abi,
    functionName: "commitToDistribution",
    args: [amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: cdHash });

  return {
    depositHash: depHash,
    logicProcessHash: lpHash,
    recordHash,
    commitDistributionHash: cdHash,
  };
}