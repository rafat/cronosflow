import { NextResponse } from "next/server";
import { db, assets } from "@/src/lib/db";
import { eq } from "drizzle-orm";
import { txSimulatePaymentAndDistribution } from "@/src/lib/chain/write";

export async function POST(req: Request) {
  const { assetId, from, amount } = await req.json().catch(() => ({}));

  if (!assetId || !from || !amount) {
    return NextResponse.json(
      { error: "assetId, from, amount required" },
      { status: 400 },
    );
  }

  const [row] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  const res = await txSimulatePaymentAndDistribution({
    assetId: BigInt(row.onchainAssetId),
    from,
    amount: BigInt(amount),
    registry: row.registryAddress as `0x${string}`,
    vault: row.vaultAddress as `0x${string}`,
    logic: row.logicAddress as `0x${string}`,
  });

  return NextResponse.json(res);
}