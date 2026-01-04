import { NextResponse } from "next/server";
import { db, assets } from "@/src/lib/db";
import { runAgentForAsset } from "@/src/lib/agents/orchestrator";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.select().from(assets); // could filter ACTIVE only based on statusCache

  const results = [];
  for (const a of rows) {
    const r = await runAgentForAsset(a.id, "cron");
    results.push({ assetId: a.id, ...r });
  }

  return NextResponse.json({ ok: true, results });
}