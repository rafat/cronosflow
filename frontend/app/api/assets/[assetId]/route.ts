import { NextResponse } from "next/server";
import { db, assets } from "@/src/lib/db";
import { eq } from "drizzle-orm";

interface Params {
  params: { assetId: string };
}

export async function GET(_req: Request, { params }: Params) {
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