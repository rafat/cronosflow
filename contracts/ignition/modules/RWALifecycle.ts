import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

const ADMIN_ADDRESS = "0xE5d7e81226E2Ca1355F8954673eCe59Fe40fDBFd";
const AGENT_ADDRESS = "0x09ef97ea756496cd7a8E6a045B033A17A0B2B4A0";
const FEE_RECIPIENT_ADDRESS = "0x3cb6A70E6B60dC5b7d614dDa937AAe170f9D3c79"; 

const ROLES = {
  ASSET_FACTORY: ethers.id("ASSET_FACTORY"),
  ASSET_MANAGER: ethers.id("ASSET_MANAGER"),
  PAYMENT_COLLECTOR: ethers.id("PAYMENT_COLLECTOR"),
  COMPLIANCE: ethers.id("COMPLIANCE_OFFICER"),
  EMERGENCY: ethers.id("EMERGENCY_ADMIN"),
  PAYMENT_PROCESSOR: ethers.id("PAYMENT_PROCESSOR"),
  STRATEGY_MANAGER: ethers.id("STRATEGY_MANAGER"),
};

export default buildModule("RWALifecycleModule", (m) => {
  const admin = m.getParameter("admin", ADMIN_ADDRESS);
  const agent = m.getParameter("agent", AGENT_ADDRESS);
  const feeRecipient = m.getParameter("feeRecipient", FEE_RECIPIENT_ADDRESS);
  const USDC_TESTNET = m.getParameter(
    "usdc.e",
    "0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0"
  );
  const assetId = m.getParameter("assetId", 1);

  const registry = m.contract("RWAAssetRegistry", [admin]);
  const logicTemplate = m.contract("RentalCashFlowLogic");
  const vault = m.contract("RWARevenueVault");

  const token = m.contract("InvestorShareToken", [
    assetId,
    "RWA Real Estate Share",
    "RWA-RES",
    ethers.parseEther("1000000"),
    registry,
    vault,
    admin,
  ]);

  m.call(registry, "grantRole", [ROLES.ASSET_FACTORY, agent]);
  m.call(registry, "grantRole", [ROLES.ASSET_MANAGER, agent]);
  m.call(registry, "grantRole", [ROLES.PAYMENT_COLLECTOR, agent]);
  m.call(registry, "grantRole", [ROLES.COMPLIANCE, admin]);
  m.call(registry, "grantRole", [ROLES.EMERGENCY, admin]);

  m.call(vault, "initialize", [
    admin,
    agent,
    logicTemplate,
    USDC_TESTNET,
    registry,
    assetId,
    feeRecipient,
  ]);

  m.call(vault, "setTokenContracts", [token]);

  return { registry, logicTemplate, vault, token };
});