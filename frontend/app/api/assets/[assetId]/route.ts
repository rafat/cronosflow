import { NextRequest, NextResponse } from "next/server";
import { db, assets } from "@/src/lib/db";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ assetId: string }> }
) {
  const params = await context.params;
  const row = await db
    .select()
    .from(assets)
    .where(eq(assets.id, params.assetId))
    .limit(1);

  if (!row[0]) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  return NextResponse.json(row[0]);
}