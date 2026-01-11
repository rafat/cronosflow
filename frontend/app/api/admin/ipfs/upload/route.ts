import { NextResponse } from "next/server";

function requireAdmin(req: Request) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET not set");
  return req.headers.get("x-admin-secret") === secret;
}

export async function POST(req: Request) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { PINATA_JWT } = process.env;
  if (!PINATA_JWT) {
    return NextResponse.json(
      { error: "Pinata JWT is not configured in .env file." },
      { status: 500 }
    );
  }

  try {
    // The incoming request is FormData, which we pass along
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Pinata requires specific field names and options.
    // We recreate the FormData to ensure it's in the format Pinata expects.
    const pinataFormData = new FormData();
    pinataFormData.append("file", file);
    pinataFormData.append(
      "pinataMetadata",
      JSON.stringify({ name: file.name || "RWA Asset Document" })
    );
    pinataFormData.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
      },
      body: pinataFormData,
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(
        `Pinata API request failed: ${errorData.error?.reason || "Unknown error"}`
      );
    }

    const { IpfsHash } = await res.json();

    return NextResponse.json({ ipfsHash: IpfsHash });
  } catch (e: any) {
    console.error("IPFS Upload Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
