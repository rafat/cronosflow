import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

const ADMIN_ADDRESS = "0xE5d7e81226E2Ca1355F8954673eCe59Fe40fDBFd";
const AGENT_ADDRESS = "0x09ef97ea756496cd7a8E6a045B033A17A0B2B4A0";

const ROLES = {
  ASSET_FACTORY_ROLE: ethers.id("ASSET_FACTORY"),
  ASSET_MANAGER_ROLE: ethers.id("ASSET_MANAGER"),
  PAYMENT_COLLECTOR_ROLE: ethers.id("PAYMENT_COLLECTOR"),
  COMPLIANCE_ROLE: ethers.id("COMPLIANCE_OFFICER"),
};

/**
 * This module deploys only the RWAAssetRegistry contract, which serves as the
 * central entry point and factory for the entire system.
 *
 * It also grants the necessary initial roles to the admin and agent accounts.
 */
export default buildModule("RegistryModule", (m) => {
  const admin = m.getParameter("admin", ADMIN_ADDRESS);
  const agent = m.getParameter("agent", AGENT_ADDRESS);

  const registry = m.contract("RWAAssetRegistry", [admin]);

  // Grant initial roles
  m.call(registry, "grantRole", [ROLES.ASSET_FACTORY_ROLE, admin], {
    id: "GrantAssetFactoryRole",
  });
  m.call(registry, "grantRole", [ROLES.ASSET_MANAGER_ROLE, agent], {
    id: "GrantAssetManagerRole",
  });
  m.call(registry, "grantRole", [ROLES.PAYMENT_COLLECTOR_ROLE, agent], {
    id: "GrantPaymentCollectorRole",
  });
  m.call(registry, "grantRole", [ROLES.COMPLIANCE_ROLE, admin], {
    id: "GrantComplianceRole",
  });

  return { registry };
});
