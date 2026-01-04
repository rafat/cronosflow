import Link from "next/link";

type AssetRow = {
  id: string;
  name: string;
  symbol: string;
  onchainAssetId: string;
  statusCache: any | null;
};

async function fetchAssets(): Promise<AssetRow[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/assets`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to load assets");
  return res.json();
}

export default async function AssetsPage() {
  const rows = await fetchAssets();

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Assets</h1>

      <div className="space-y-2">
        {rows.length === 0 && <p>No assets yet. Create one from Admin.</p>}
        {rows.map((a) => (
          <div key={a.id} className="border rounded p-3 flex justify-between items-center">
            <div>
              <div className="font-medium">
                {a.name} ({a.symbol})
              </div>
              <div className="text-xs text-gray-500">
                on-chain assetId: {a.onchainAssetId.toString()}
              </div>
              {a.statusCache && (
                <div className="text-xs text-gray-400">
                  status: {a.statusCache.registryStatus} · health:{" "}
                  {a.statusCache.cashflowHealth}
                </div>
              )}
            </div>
            <Link
              href={`/assets/${a.id}`}
              className="text-sm px-3 py-1 border rounded hover:bg-gray-100"
            >
              View
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}