import { NextResponse } from "next/server";
import { runAgentForAsset } from "@/src/lib/agents/orchestrator";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const assetId = body.assetId as string | undefined;

  if (!assetId) {
    return NextResponse.json({ error: "assetId required" }, { status: 400 });
  }

  const result = await runAgentForAsset(assetId, "manual");
  return NextResponse.json(result);
}