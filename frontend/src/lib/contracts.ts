import registryArtifact from "@/src/contracts/RWAAssetRegistry.json";
import logicArtifact from "@/src/contracts/RentalCashFlowLogic.json";
import vaultArtifact from "@/src/contracts/RWARevenueVault.json";
import tokenArtifact from "@/src/contracts/InvestorShareToken.json";

export const Registry = {
  abi: registryArtifact.abi,
  bytecode: registryArtifact.bytecode as `0x${string}`,
};

export const RentalLogic = {
  abi: logicArtifact.abi,
  bytecode: logicArtifact.bytecode as `0x${string}`,
};

export const Vault = {
  abi: vaultArtifact.abi,
  bytecode: vaultArtifact.bytecode as `0x${string}`,
};

export const ShareToken = {
  abi: tokenArtifact.abi,
  bytecode: tokenArtifact.bytecode as `0x${string}`,
};