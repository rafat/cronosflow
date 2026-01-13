import "server-only";
import { db, assets, paymentRequests, agentRuns } from "@/src/lib/db";
import { eq } from "drizzle-orm";
import {
  readLogicSchedule,
  readLogicPreview,
  readVaultState,
  readRegistryAsset,
  type RealWorldAsset,
  type LogicSchedule,
  type LogicPreview,
  type VaultState,
} from "@/src/lib/chain/read";
import {
  txCheckAndTriggerDefault,
  txCommitDistribution,
} from "@/src/lib/chain/write";
import { randomUUID } from "crypto";
import { x402Client } from "@/src/lib/x402/client";

export async function toolSyncState(assetId: string) {
  const [row] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) throw new Error("Asset not found");

  const onchainId = BigInt(row.onchainAssetId);

  const [registryState, schedule, preview, vault] = await Promise.all([
    readRegistryAsset(row.registryAddress as `0x${string}`, onchainId),
    readLogicSchedule(row.logicAddress as `0x${string}`),
    readLogicPreview(row.logicAddress as `0x${string}`),
    readVaultState(row.vaultAddress as `0x${string}`),
  ]) as [RealWorldAsset, LogicSchedule, LogicPreview, VaultState];

  // Optionally cache some fields in DB for faster list view
  await db
    .update(assets)
    .set({
      statusCache: {
        registryStatus: String(registryState.currentStatus),
        cashflowHealth: String(schedule.cashflowHealth ?? preview.cashflowHealth ?? ""),
        nextDueDate: schedule.nextPaymentDueDate.toString(),
        expectedPeriodicPayment: schedule.expectedPeriodicPayment.toString(),
        expectedMaturityDate: schedule.expectedMaturityDate.toString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId));

  return { registryState, schedule, preview, vault };
}

// x402-aware: create payment request
export async function toolCreatePaymentRequest(assetId: string, amount: bigint, dueAt: Date) {
  const id = randomUUID();

  // Insert initial payment request record in DB
  await db.insert(paymentRequests).values({
    id,
    assetId,
    amount,
    dueAt,
    status: "CREATED",
    reference: `asset-${assetId}-${Date.now()}`,
    providerPayload: null, // Will be updated after x402 call
  });

  // Call x402 facilitator to create an actual payment request
  const x402Response = await x402Client.createPaymentRequest({
    assetId,
    amount,
    dueAt,
    reference: id, // Use internal ID as reference for x402
  });

  // Update DB record with x402 response and SENT status
  await db.update(paymentRequests).set({
    status: "SENT",
    providerPayload: x402Response,
    updatedAt: new Date(),
  }).where(eq(paymentRequests.id, id));

  return {
    paymentRequestId: id,
    amount: amount.toString(),
    dueAt: dueAt.toISOString(),
    x402Response,
  };
}

export async function toolCommitDistribution(assetId: string) {
  const [row] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) throw new Error("Asset not found");

  const schedule = await readLogicSchedule(row.logicAddress as `0x${string}`);
  const vaultState = await readVaultState(row.vaultAddress as `0x${string}`);

  const expected = schedule.expectedPeriodicPayment;
  if (vaultState.totalIdle < expected) {
    return {
      skipped: true,
      reason: "Insufficient idle funds for expected payment",
      expected: expected.toString(),
      totalIdle: vaultState.totalIdle.toString(),
    };
  }

  const { hash } = await txCommitDistribution(row.vaultAddress as `0x${string}`, expected);

  return {
    skipped: false,
    txHash: hash,
    expected: expected.toString(),
  };
}

export async function toolTriggerDefaultCheck(assetId: string) {
  const [row] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) throw new Error("Asset not found");

  const { hash } = await txCheckAndTriggerDefault(
    row.registryAddress as `0x${string}`,
    BigInt(row.onchainAssetId),
  );

  return { txHash: hash };
}

// Helper to record an agent run in DB
export async function recordAgentRun(params: {
  assetId: string;
  mode: "manual" | "cron";
  plan: any;
  actions: any[];
  result: "SUCCESS" | "FAILED";
  error?: string;
}) {
  const { assetId, mode, plan, actions, result, error } = params;
  await db.insert(agentRuns).values({
    assetId,
    mode,
    startedAt: new Date(),
    finishedAt: new Date(),
    plan,
    actions,
    result,
    error: error ?? null,
  });
}