import "server-only";
import { publicClient } from "./clients";
import { Registry, RentalLogic, Vault, ShareToken } from "@/src/lib/contracts";

export type RealWorldAsset = {
  assetId: bigint;
  assetType: number;
  originator: `0x${string}`;
  logicContract: `0x${string}`;
  vaultContract: `0x${string}`;
  tokenContract: `0x${string}`;
  isKYCVerified: boolean;
  isPaused: boolean;
  assetValue: bigint;
  accumulatedYield: bigint;
  lastValuationDate: bigint;
  lastPaymentDate: bigint;
  missedPayments: bigint;
  daysInDefault: bigint;
  lastYieldDistributionDate: bigint;
  totalYieldDistributed: bigint;
  nextPaymentDueDate: bigint;
  expectedMonthlyPayment: bigint;
  expectedMaturityDate: bigint;
  valuationOracle: `0x${string}`;
  currentStatus: number;
  statusBeforePause: number;
  registrationDate: bigint;
  activationDate: bigint;
};

export type LogicSchedule = {
  nextPaymentDueDate: bigint;
  expectedPeriodicPayment: bigint;
  expectedMaturityDate: bigint;
  totalReceived: bigint;
  cashflowHealth: number;
};

export type LogicPreview = {
  assetStatus: number;
  cashflowHealth: number;
  daysPastDue: bigint;
  periodIndex: bigint;
};

export type VaultState = {
  totalIdle: bigint;
  totalDistributable: bigint;
  cumulativeRewardPerToken: bigint;
};

export type TokenState = {
  totalSupply: bigint;
};

export async function readRegistryAsset(registry: `0x${string}`, assetId: bigint): Promise<RealWorldAsset> {
  // public mapping: assets(uint256) returns RealWorldAsset struct
  const asset = await publicClient.readContract({
    address: registry,
    abi: Registry.abi,
    functionName: "assets",
    args: [assetId],
  });
  return asset as RealWorldAsset;
}

export async function readLogicSchedule(logic: `0x${string}`): Promise<LogicSchedule> {
  const [schedule, totalReceived, cashflowHealth] = await Promise.all([
    publicClient.readContract({
      address: logic,
      abi: RentalLogic.abi,
      functionName: "getSchedule",
    }),
    publicClient.readContract({
      address: logic,
      abi: RentalLogic.abi,
      functionName: "getTotalReceived",
    }),
    publicClient.readContract({
      address: logic,
      abi: RentalLogic.abi,
      functionName: "getCashflowHealth",
    }),
  ]) as [readonly [bigint, bigint, bigint], bigint, number];
  // getSchedule returns (nextDueDate, expectedPeriodicPayment, expectedMaturityDate)
  return {
    nextPaymentDueDate: schedule[0] as bigint,
    expectedPeriodicPayment: schedule[1] as bigint,
    expectedMaturityDate: schedule[2] as bigint,
    totalReceived: totalReceived as bigint,
    cashflowHealth: cashflowHealth as number,
  };
}

export async function readLogicPreview(logic: `0x${string}`): Promise<LogicPreview> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const preview = await publicClient.readContract({
    address: logic,
    abi: RentalLogic.abi,
    functionName: "previewDefault",
    args: [now],
  }) as [number, number, bigint, bigint];
  // returns (AssetStatus, CashflowHealth, daysPastDue, period)
  return {
    assetStatus: preview[0] as number,
    cashflowHealth: preview[1] as number,
    daysPastDue: preview[2] as bigint,
    periodIndex: preview[3] as bigint,
  };
}

export async function readVaultState(vault: `0x${string}`): Promise<VaultState> {
  const [idle, distributable, rewardPerToken] = await Promise.all([
    publicClient.readContract({
      address: vault,
      abi: Vault.abi,
      functionName: "getAvailableForDeployment",
    }),
    publicClient.readContract({
      address: vault,
      abi: Vault.abi,
      functionName: "getAvailableForInvestors",
    }),
    publicClient.readContract({
      address: vault,
      abi: Vault.abi,
      functionName: "cumulativeRewardPerToken",
    }),
  ]);

  return {
    totalIdle: idle as bigint,
    totalDistributable: distributable as bigint,
    cumulativeRewardPerToken: rewardPerToken as bigint,
  };
}

export async function readTokenState(token: `0x${string}`): Promise<TokenState> {
  const totalSupply = await publicClient.readContract({
    address: token,
    abi: ShareToken.abi,
    functionName: "totalSupply",
  });
  return {
    totalSupply: totalSupply as bigint,
  };
}