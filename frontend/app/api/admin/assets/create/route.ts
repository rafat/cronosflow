import { NextResponse } from "next/server";
import { z } from "zod";
import { encodeAbiParameters, parseAbiParameters, parseEventLogs } from "viem";
import { publicClient, walletClient, agentAccount } from "@/src/lib/chain/clients";
import { deployContract } from "@/src/lib/chain/deploy";
import { Registry, RentalLogic, Vault, ShareToken } from "@/src/lib/contracts";

const CreateSchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1).max(12),
  maxSupply: z.string(),
  assetValue: z.string(),
  ipfsHash: z.string().min(1),

  rentAmount: z.string(),
  interval: z.number().int().positive(),
  grace: z.number().int().nonnegative(),
  months: z.number().int().positive(),
  timeUnitSeconds: z.number().int().positive(),

  originator: z.string().optional(),
  paymentToken: z.string().optional(),
});

function requireAdmin(req: Request) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET not set");
  return req.headers.get("x-admin-secret") === secret;
}

export async function POST(req: Request) {
  try {
    if (!requireAdmin(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = CreateSchema.parse(await req.json());

    const registryAddress = process.env.REGISTRY_ADDRESS as `0x${string}` | undefined;
    if (!registryAddress) throw new Error("REGISTRY_ADDRESS missing");

    const paymentToken =
      (body.paymentToken ?? process.env.TESTNET_USDC_ADDRESS) as `0x${string}` | undefined;
    if (!paymentToken) throw new Error("TESTNET_USDC_ADDRESS missing (or provide paymentToken)");

    const originator = (body.originator ?? agentAccount.address) as `0x${string}`;

    // --- Time & Money Conversions ---
    const rent = BigInt(Math.floor(Number(body.rentAmount))) * BigInt(10) ** BigInt(18);
    const maxSupply = BigInt(Math.floor(Number(body.maxSupply))) * BigInt(10) ** BigInt(18);

    const timeUnitSeconds = BigInt(body.timeUnitSeconds);
    const intervalSeconds = BigInt(body.interval) * timeUnitSeconds;
    const graceUnits = BigInt(body.grace);

    const now = BigInt(Math.floor(Date.now() / 1000));
    const firstDue = now + BigInt(60); // First payment due in ~60s
    const leaseEnd = firstDue + BigInt(body.months) * intervalSeconds;
    // --- End Time & Money Conversions ---

    // 1) KYC originator (demo)
    const kycHash = await walletClient.writeContract({
      address: registryAddress,
      abi: Registry.abi,
      functionName: "verifyKYC",
      args: [originator],
    });
    await publicClient.waitForTransactionReceipt({ hash: kycHash });

    // 2) Register asset (AssetType.REAL_ESTATE = 0)
    const registerHash = await walletClient.writeContract({
      address: registryAddress,
      abi: Registry.abi,
      functionName: "registerAsset",
      args: [0, originator, BigInt(body.assetValue), body.ipfsHash],
    });
    const registerRcpt = await publicClient.waitForTransactionReceipt({ hash: registerHash });

    const regLogs = parseEventLogs({
      abi: Registry.abi,
      logs: registerRcpt.logs,
      eventName: "AssetRegistered",
    });
    if (regLogs.length === 0) throw new Error("AssetRegistered event not found");
    const firstLog = regLogs[0] as any;
    const onchainAssetId = firstLog.args.assetId as bigint;

    // 3) Deploy logic + initialize(initData)
    const logicDeploy = await deployContract({
      abi: RentalLogic.abi,
      bytecode: RentalLogic.bytecode,
      args: [],
    });

    const initData = encodeAbiParameters(
      parseAbiParameters("uint256, uint256, uint256, uint256, uint256, uint256, address"),
      [rent, intervalSeconds, firstDue, graceUnits, leaseEnd, timeUnitSeconds, registryAddress]
    );

    const logicInitHash = await walletClient.writeContract({
      address: logicDeploy.address,
      abi: RentalLogic.abi,
      functionName: "initialize",
      args: [initData],
    });
    await publicClient.waitForTransactionReceipt({ hash: logicInitHash });

    // 4) Deploy vault + initialize
    const vaultDeploy = await deployContract({
      abi: Vault.abi,
      bytecode: Vault.bytecode,
      args: [],
    });

    const vaultInitHash = await walletClient.writeContract({
      address: vaultDeploy.address,
      abi: Vault.abi,
      functionName: "initialize",
      args: [agentAccount.address, logicDeploy.address, paymentToken, registryAddress, onchainAssetId],
    });
    await publicClient.waitForTransactionReceipt({ hash: vaultInitHash });

    // 5) Deploy token
    const tokenDeploy = await deployContract({
      abi: ShareToken.abi,
      bytecode: ShareToken.bytecode,
      args: [onchainAssetId, body.name, body.symbol, maxSupply, registryAddress, vaultDeploy.address],
    });

    // set token in vault
    const setTokenHash = await walletClient.writeContract({
      address: vaultDeploy.address,
      abi: Vault.abi,
      functionName: "setTokenContracts",
      args: [tokenDeploy.address],
    });
    await publicClient.waitForTransactionReceipt({ hash: setTokenHash });

    // 6) Link contracts
    const linkHash = await walletClient.writeContract({
      address: registryAddress,
      abi: Registry.abi,
      functionName: "linkContracts",
      args: [onchainAssetId, logicDeploy.address, vaultDeploy.address, tokenDeploy.address],
    });
    await publicClient.waitForTransactionReceipt({ hash: linkHash });

    // 7) Whitelist + activate (demo)
    const whitelistHash = await walletClient.writeContract({
      address: registryAddress,
      abi: Registry.abi,
      functionName: "whitelistAsset",
      args: [onchainAssetId],
    });
    await publicClient.waitForTransactionReceipt({ hash: whitelistHash });

    const activateHash = await walletClient.writeContract({
      address: registryAddress,
      abi: Registry.abi,
      functionName: "activateAsset",
      args: [onchainAssetId],
    });
    await publicClient.waitForTransactionReceipt({ hash: activateHash });

    // TODO: insert into DB (assets table) here

    return NextResponse.json({
      onchainAssetId: onchainAssetId.toString(),
      registry: registryAddress,
      logic: logicDeploy.address,
      vault: vaultDeploy.address,
      token: tokenDeploy.address,
      txs: {
        kycHash,
        registerHash,
        logicDeployHash: logicDeploy.hash,
        logicInitHash,
        vaultDeployHash: vaultDeploy.hash,
        vaultInitHash,
        tokenDeployHash: tokenDeploy.hash,
        setTokenHash,
        linkHash,
        whitelistHash,
        activateHash,
      },
      schedule: {
        rent: rent.toString(),
        intervalSeconds: intervalSeconds.toString(),
        firstDue: firstDue.toString(),
        leaseEnd: leaseEnd.toString(),
        graceUnits: graceUnits.toString(),
        timeUnitSeconds: timeUnitSeconds.toString(),
      },
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 400 });
  }
}