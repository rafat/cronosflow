import fs from "fs";
import path from "path";

const frontendRoot = process.cwd();               // repo/frontend
const repoRoot = path.resolve(frontendRoot, "..");

const targets = [
  {
    from: "contracts/artifacts/contracts/RWAAssetRegistry.sol/RWAAssetRegistry.json",
    to: "frontend/src/contracts/RWAAssetRegistry.json",
  },
  {
    from: "contracts/artifacts/contracts/RentalCashFlowLogic.sol/RentalCashFlowLogic.json",
    to: "frontend/src/contracts/RentalCashFlowLogic.json",
  },
  {
    from: "contracts/artifacts/contracts/RWARevenueVault.sol/RWARevenueVault.json",
    to: "frontend/src/contracts/RWARevenueVault.json",
  },
  {
    from: "contracts/artifacts/contracts/InvestorShareToken.sol/InvestorShareToken.json",
    to: "frontend/src/contracts/InvestorShareToken.json",
  },
  {
    from: "contracts/artifacts/contracts/mocks/MockERC20.sol/MockERC20.json",
    to: "frontend/src/contracts/MockERC20.json",
  },
];

for (const t of targets) {
  const src = path.join(repoRoot, t.from);
  const dst = path.join(repoRoot, t.to);

  if (!fs.existsSync(src)) {
    throw new Error(`Missing artifact: ${src}. Run (cd contracts && npx hardhat compile) first.`);
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`Copied ${t.from} -> ${t.to}`);
}