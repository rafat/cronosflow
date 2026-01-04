import { NextResponse } from "next/server";
import { db, assets } from "@/src/lib/db";
import { eq } from "drizzle-orm";
import {
  readRegistryAsset,
  readLogicSchedule,
  readLogicPreview,
  readVaultState,
  readTokenState,
} from "@/src/lib/chain/read";

interface Params {
  params: { assetId: string };
}

export async function GET(_req: Request, { params }: Params) {
  const [row] = await db.select().from(assets).where(eq(assets.id, params.assetId)).limit(1);

  if (!row) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const assetIdBig = BigInt(row.onchainAssetId);

  const [registryState, schedule, preview, vaultState, tokenState] = await Promise.all([
    readRegistryAsset(row.registryAddress as `0x${string}`, assetIdBig),
    readLogicSchedule(row.logicAddress as `0x${string}`),
    readLogicPreview(row.logicAddress as `0x${string}`),
    readVaultState(row.vaultAddress as `0x${string}`),
    readTokenState(row.tokenAddress as `0x${string}`),
  ]);

  return NextResponse.json({
    registry: registryState,
    logicSchedule: schedule,
    logicPreview: preview,
    vault: vaultState,
    token: tokenState,
  });
}