import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

// Constants from your requirements
const ADMIN_ADDRESS = "0xE5d7e81226E2Ca1355F8954673eCe59Fe40fDBFd";
const AGENT_ADDRESS = "0x09ef97ea756496cd7a8E6a045B033A17A0B2B4A0";

// Role Hashes
const ROLES = {
  ASSET_FACTORY: ethers.id("ASSET_FACTORY"),
  ASSET_MANAGER: ethers.id("ASSET_MANAGER"),
  PAYMENT_COLLECTOR: ethers.id("PAYMENT_COLLECTOR"),
  COMPLIANCE: ethers.id("COMPLIANCE_OFFICER"),
  ORACLE: ethers.id("ORACLE_FEEDER"),
  EMERGENCY: ethers.id("EMERGENCY_ADMIN"),
  PAYMENT_PROCESSOR: ethers.id("PAYMENT_PROCESSOR"),
  STRATEGY_MANAGER: ethers.id("STRATEGY_MANAGER"),
};

export default buildModule("RWALifecycleModule", (m) => {
  // 1. Deploy Registry
  const registry = m.contract("RWAAssetRegistry");

  // 2. Deploy Logic Template (Rental)
  const logic = m.contract("RentalCashFlowLogic");

  // 3. Deploy Revenue Vault
  const vault = m.contract("RWARevenueVault");

  // 4. Setup Roles on Registry
  // Grant Admin Roles
  m.call(registry, "grantRole", [ethers.ZeroHash, ADMIN_ADDRESS], { id: "Grant_Admin_Registry" });
  m.call(registry, "grantRole", [ROLES.EMERGENCY, ADMIN_ADDRESS], { id: "Grant_Emergency_Registry" });
  m.call(registry, "grantRole", [ROLES.COMPLIANCE, ADMIN_ADDRESS], { id: "Grant_Compliance_Registry" });

  // Grant Agent Roles
  m.call(registry, "grantRole", [ROLES.ASSET_FACTORY, AGENT_ADDRESS], { id: "Grant_Factory_Agent" });
  m.call(registry, "grantRole", [ROLES.ASSET_MANAGER, AGENT_ADDRESS], { id: "Grant_Manager_Agent" });
  m.call(registry, "grantRole", [ROLES.PAYMENT_COLLECTOR, AGENT_ADDRESS], { id: "Grant_Collector_Agent" });
  m.call(registry, "grantRole", [ROLES.ORACLE, AGENT_ADDRESS], { id: "Grant_Oracle_Agent" });

  // 5. Initialize Vault (Using USDC Testnet address example - replace with actual token)
  const USDC_TESTNET = "0x2f974C5602764956562098485208f6B424C6A928"; // Placeholder
  m.call(vault, "initialize", [
    ADMIN_ADDRESS, 
    logic, 
    USDC_TESTNET, 
    registry, 
    1 // Initial Asset ID placeholder
  ]);

  // 6. Deploy Token (Needs Vault address)
  const token = m.contract("InvestorShareToken", [
    1,                       // assetId
    "RWA Cronos Property",   // name
    "RWACP",                 // symbol
    ethers.parseEther("1000000"), // maxSupply
    registry,
    vault
  ]);

  // 7. Link Token back to Vault
  m.call(vault, "setTokenContracts", [token], { id: "Link_Token_To_Vault" });

  // 8. Setup Roles on Vault
  m.call(vault, "grantRole", [ROLES.PAYMENT_PROCESSOR, AGENT_ADDRESS], { id: "Grant_Vault_Payment_Agent" });
  m.call(vault, "grantRole", [ROLES.STRATEGY_MANAGER, AGENT_ADDRESS], { id: "Grant_Vault_Strategy_Agent" });

  return { registry, logic, vault, token };
});