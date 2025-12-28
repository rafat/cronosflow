"use client";

import { useState } from "react";

export default function NewAssetPage() {
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setRes(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);

    const payload = {
      name: String(form.get("name")),
      symbol: String(form.get("symbol")),
      maxSupply: String(form.get("maxSupply")),
      assetValue: String(form.get("assetValue")),
      ipfsHash: String(form.get("ipfsHash")),
      rentAmount: String(form.get("rentAmount")),
      intervalDays: Number(form.get("intervalDays")),
      graceDays: Number(form.get("graceDays")),
      months: Number(form.get("months")),
      paymentToken: String(form.get("paymentToken") || ""),
    };

    try {
      const r = await fetch("/api/admin/assets/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-secret": prompt("Enter ADMIN_SECRET") || "",
        },
        body: JSON.stringify(payload),
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Request failed");
      setRes(j);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1>Create Rental Asset (Demo Mode)</h1>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input name="name" placeholder="Token name" defaultValue="SG Office #12" />
        <input name="symbol" placeholder="Symbol" defaultValue="RWA12" />
        <input name="maxSupply" placeholder="Max supply" defaultValue="1000" />

        <input name="assetValue" placeholder="Asset value" defaultValue="1000000" />
        <input name="ipfsHash" placeholder="ipfs://..." defaultValue="ipfs://demo" />

        <hr />

        <input name="rentAmount" placeholder="Rent amount" defaultValue="1000" />
        <input name="intervalDays" placeholder="Interval days" defaultValue="30" />
        <input name="graceDays" placeholder="Grace days" defaultValue="5" />
        <input name="months" placeholder="Lease months" defaultValue="6" />

        <input
          name="paymentToken"
          placeholder="Payment token address (blank uses TESTNET_USDC_ADDRESS)"
        />

        <button disabled={loading} type="submit">
          {loading ? "Creating (deploying contracts)..." : "Create & Activate"}
        </button>
      </form>

      {err && <pre style={{ color: "red", marginTop: 16 }}>{err}</pre>}
      {res && (
        <pre style={{ marginTop: 16, background: "#111", color: "#0f0", padding: 12 }}>
          {JSON.stringify(res, null, 2)}
        </pre>
      )}
    </div>
  );
}