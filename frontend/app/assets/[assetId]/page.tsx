"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

interface Params {
  params: { assetId: string };
}

// Note: In a real app, you'd use a dedicated data fetching library like SWR or React Query
// and not fetch data directly in a client component like this on every render.
// This is simplified for the demo.
export default function AssetDetailPage({ params }: Params) {
  const [asset, setAsset] = useState<any>(null);
  const [state, setState] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const [runRes, setRunRes] = useState<any>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchAsset(assetId: string) {
      const res = await fetch(`/api/assets/${assetId}`);
      if (!res.ok) throw new Error("Asset not found");
      return res.json();
    }

    async function fetchState(assetId: string) {
      const res = await fetch(`/api/assets/${assetId}/state`);
      if (!res.ok) throw new Error("Failed to load state");
      return res.json();
    }

    setErr(null);
    Promise.all([fetchAsset(params.assetId), fetchState(params.assetId)])
      .then(([assetData, stateData]) => {
        setAsset(assetData);
        setState(stateData);
      })
      .catch((e) => setErr(e.message));
  }, [params.assetId]);

  async function onRunAgent() {
    setLoading(true);
    setRunErr(null);
    setRunRes(null);

    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-secret": prompt("Enter ADMIN_SECRET") || "",
        },
        body: JSON.stringify({ assetId: params.assetId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Agent run failed");
      setRunRes(json);
    } catch (e: any) {
      setRunErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (err) {
    return <div className="p-6">Error: {err}</div>;
  }

  if (!asset || !state) {
    return <div className="p-6">Loading...</div>;
  }

  const schedule = state.logicSchedule;
  const vault = state.vault;
  const preview = state.logicPreview;

  let timeUnitLabel = "seconds";
  if (Number(preview.timeUnit) === 60) {
    timeUnitLabel = "minutes";
  } else if (Number(preview.timeUnit) === 86400) {
    timeUnitLabel = "days";
  }

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
            <div>
              Next due:{" "}
              {Number(schedule.nextPaymentDueDate)
                ? new Date(Number(schedule.nextPaymentDueDate) * 1000).toISOString()
                : "-"}
            </div>
            <div>Expected: {schedule.expectedPeriodicPayment.toString()}</div>
            <div>
              Maturity:{" "}
              {Number(schedule.expectedMaturityDate)
                ? new Date(Number(schedule.expectedMaturityDate) * 1000).toISOString()
                : "-"}
            </div>
          </div>
        </div>

        <div className="border rounded p-3">
          <h2 className="font-medium mb-2">Health</h2>
          <div className="text-xs">
            <div>Cashflow health: {preview.cashflowHealth}</div>
            <div>Asset status: {preview.assetStatus}</div>
            <div>
              Past due ({timeUnitLabel}): {preview.daysPastDue.toString()}
            </div>
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
        <div className="flex flex-col items-start gap-4">
          <button
            onClick={onRunAgent}
            disabled={loading}
            className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            {loading ? "Running Agent..." : "Run Agent"}
          </button>

          {runErr && <pre className="text-xs text-red-400 bg-red-950 p-2 w-full">{runErr}</pre>}
          {runRes && (
            <pre className="text-xs text-green-400 bg-green-950 p-2 w-full">
              {JSON.stringify(runRes, null, 2)}
            </pre>
          )}
        </div>
      </section>
    </div>
  );
}