import Link from "next/link";

interface Params {
  params: { assetId: string };
}

async function fetchAsset(assetId: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/assets/${assetId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Asset not found");
  return res.json();
}

async function fetchState(assetId: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/assets/${assetId}/state`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Failed to load state");
  return res.json();
}

export default async function AssetDetailPage({ params }: Params) {
  const asset = await fetchAsset(params.assetId);
  const state = await fetchState(params.assetId);

  const schedule = state.logicSchedule;
  const vault = state.vault;
  const preview = state.logicPreview;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {asset.name} ({asset.symbol})
          </h1>
          <div className="text-xs text-gray-500">Asset ID: {asset.id}</div>
        </div>
        <Link href="/assets" className="text-sm underline">
          Back to list
        </Link>
      </div>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="border rounded p-3">
          <h2 className="font-medium mb-2">Schedule</h2>
          <div className="text-xs">
            <div>Next due: {Number(schedule.nextPaymentDueDate) ? new Date(Number(schedule.nextPaymentDueDate) * 1000).toISOString() : "-"}</div>
            <div>Expected: {schedule.expectedPeriodicPayment.toString()}</div>
            <div>Maturity: {Number(schedule.expectedMaturityDate) ? new Date(Number(schedule.expectedMaturityDate) * 1000).toISOString() : "-"}</div>
          </div>
        </div>

        <div className="border rounded p-3">
          <h2 className="font-medium mb-2">Health</h2>
          <div className="text-xs">
            <div>Cashflow health: {preview.cashflowHealth}</div>
            <div>Asset status: {preview.assetStatus}</div>
            <div>Days past due: {preview.daysPastDue.toString()}</div>
            <div>Last period index: {preview.periodIndex.toString()}</div>
          </div>
        </div>

        <div className="border rounded p-3">
          <h2 className="font-medium mb-2">Vault</h2>
          <div className="text-xs">
            <div>Idle: {vault.totalIdle.toString()}</div>
            <div>Distributable: {vault.totalDistributable.toString()}</div>
            <div>Reward per token: {vault.cumulativeRewardPerToken.toString()}</div>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Admin actions (demo)</h2>
        <form
          action={`/api/agent/run`}
          method="post"
          className="flex gap-2 items-center"
        >
          <input type="hidden" name="assetId" value={asset.id} />
          {/* Next app router doesn't support form->route.ts POST body by default; use fetch from client side in a real implementation.
              For brevity, link to a small JS button or use useTransition in a client component. */}
          <p className="text-xs text-gray-400">
            For now, use POST /api/agent/run with JSON: {"{ assetId: ... }"} from a
            REST client or a small client component.
          </p>
        </form>
      </section>
    </div>
  );
}