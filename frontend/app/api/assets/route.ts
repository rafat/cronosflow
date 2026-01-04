import { NextResponse } from "next/server";
import { db, assets } from "@/src/lib/db";
import { eq } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(assets).orderBy(assets.createdAt);
  return NextResponse.json(rows);
}

// Optional: allow DB-only draft creation (not on-chain) – left as stub.
export async function POST(_req: Request) {
  return NextResponse.json(
    { error: "Not implemented – use /api/admin/assets/create for on-chain creation" },
    { status: 400 },
  );
}