"use client";

import { useState, useRef } from "react";

export default function NewAssetPage() {
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeUnit, setTimeUnit] = useState(60);

  const [ipfsRes, setIpfsRes] = useState<any>(null);
  const [ipfsErr, setIpfsErr] = useState<string | null>(null);
  const [ipfsLoading, setIpfsLoading] = useState(false);
  const [ipfsHash, setIpfsHash] = useState("ipfs://");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const timeUnitLabel = timeUnit === 60 ? "Minutes" : "Days";

  async function handleIpfsUpload() {
    setIpfsLoading(true);
    setIpfsErr(null);
    setIpfsRes(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setIpfsErr("No file selected.");
      setIpfsLoading(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);

      const r = await fetch("/api/admin/ipfs/upload", {
        method: "POST",
        headers: {
          "x-admin-secret": prompt("Enter ADMIN_SECRET") || "",
        },
        body: formData,
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "IPFS upload failed");
      setIpfsRes(j);
      setIpfsHash(`ipfs://${j.ipfsHash}`);
    } catch (e: any) {
      setIpfsErr(e.message);
    } finally {
      setIpfsLoading(false);
    }
  }

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
      interval: Number(form.get("interval")),
      grace: Number(form.get("grace")),
      months: Number(form.get("months")),
      timeUnitSeconds: Number(form.get("timeUnitSeconds")),
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
      <h1>Create Rental Asset</h1>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <label>Token Name</label>
          <input name="name" defaultValue="SG Office #12" />
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label>Token Symbol</label>
          <input name="symbol" defaultValue="RWA12" />
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label>Max Supply</label>
          <input name="maxSupply" defaultValue="1000" />
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label>Asset Value ($)</label>
          <input name="assetValue" defaultValue="1000000" />
        </div>

        {/* IPFS Uploader */}
        <div style={{ display: "grid", gap: 8, border: "1px solid #444", padding: 12, borderRadius: 4 }}>
          <label>Asset Documents (Metadata)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="file" ref={fileInputRef} />
            <button type="button" onClick={handleIpfsUpload} disabled={ipfsLoading} style={{ padding: "4px 8px" }}>
              {ipfsLoading ? "Uploading..." : "Upload to IPFS"}
            </button>
          </div>
          {ipfsErr && <div style={{ color: "red", fontSize: "12px" }}>Error: {ipfsErr}</div>}
          <input name="ipfsHash" value={ipfsHash} readOnly />
          {ipfsRes && (
            <div style={{ color: "green", fontSize: "12px" }}>
              Success! CID: {ipfsRes.ipfsHash}
            </div>
          )}
        </div>

        <hr />

        <div style={{ display: "grid", gap: 4 }}>
          <label>Time Scale</label>
          <select
            name="timeUnitSeconds"
            value={timeUnit}
            onChange={(e) => setTimeUnit(Number(e.target.value))}
          >
            <option value={60}>Demo (1 min = 1 day)</option>
            <option value={86400}>Production (1 day = 1 day)</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <label>Rent Amount ($)</label>
          <input name="rentAmount" defaultValue="1000" />
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <label>Payment Interval (in {timeUnitLabel})</label>
          <input name="interval" defaultValue="30" type="number" />
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <label>Grace Period (in {timeUnitLabel})</label>
          <input name="grace" defaultValue="5" type="number" />
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <label>Lease Duration (in Months)</label>
          <input name="months" defaultValue="6" type="number" />
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <label>Payment Token Address</label>
          <input placeholder="Blank uses default (Testnet USDC)" name="paymentToken" />
        </div>

        <button disabled={loading || ipfsLoading} type="submit" style={{ marginTop: 16 }}>
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