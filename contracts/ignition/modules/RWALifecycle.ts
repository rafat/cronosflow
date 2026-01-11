import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

const ADMIN_ADDRESS = "0xE5d7e81226E2Ca1355F8954673eCe59Fe40fDBFd";
const AGENT_ADDRESS = "0x09ef97ea756496cd7a8E6a045B033A17A0B2B4A0";
const FEE_RECIPIENT_ADDRESS = "0x3cb6A70E6B60dC5b7d614dDa937AAe170f9D3c79";

const ROLES = {
  ASSET_FACTORY_ROLE: ethers.id("ASSET_FACTORY"),
  ASSET_MANAGER_ROLE: ethers.id("ASSET_MANAGER"),
  PAYMENT_COLLECTOR_ROLE: ethers.id("PAYMENT_COLLECTOR"),
  COMPLIANCE_ROLE: ethers.id("COMPLIANCE_OFFICER"),
  EMERGENCY_ADMIN_ROLE: ethers.id("EMERGENCY_ADMIN"),
  PAYMENT_ROLE: ethers.id("PAYMENT_PROCESSOR"),
  STRATEGY_ROLE: ethers.id("STRATEGY_MANAGER"),
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

  // ---- Rental economic parameters ----
  const rentAmount = m.getParameter(
    "rentAmount",
    // $1,000 in 18‑decimals
    ethers.parseEther("1000")
  );

  // IMPORTANT: this controls the time scale
  // Prod:  24 * 60 * 60 (1 day)
  // Demo:  60 (1 minute) or 60 * 60 (1 hour)
  const timeUnitSeconds = m.getParameter(
    "timeUnitSeconds",
    24 * 60 * 60 // default: 1 day
  );

  const paymentIntervalSeconds = m.getParameter(
    "paymentIntervalSeconds",
    30 * Number(timeUnitSeconds) // 30 timeUnits (e.g. 30 days in prod)
  );

  const gracePeriodUnits = m.getParameter(
    "gracePeriodUnits",
    5 // 5 timeUnits (e.g. 5 days in prod)
  );

  const leasePeriods = m.getParameter(
    "leasePeriods",
    12 // 12 rental periods (e.g. 12 months)
  );

  // Timestamps: we can't know the exact block time at module build,
  // so we use "now + offset" pattern. Here, just use a relative start:
  const firstPaymentOffset = m.getParameter(
    "firstPaymentOffset",
    60 // first due date is ~60 seconds after deployment
  );

  // ---- Contracts ----
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

  // ---- Grant roles on registry ----
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

  // ---- Initialize the vault ----
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

  // ---- Initialize the RentalCashFlowLogic with ABI‑encoded data ----
  //
  // Solidity:
  // function initialize(bytes calldata data)
  // where data = abi.encode(
  //   uint256 rentAmount,
  //   uint256 paymentIntervalSeconds,
  //   uint256 firstPaymentDueDate,
  //   uint256 gracePeriodUnits,
  //   uint256 leaseEndDate,
  //   uint256 timeUnitSeconds,
  //   address registry
  // )
  //
  // We approximate firstPaymentDueDate as "block.timestamp + firstPaymentOffset".
  // Ignition can't read block.timestamp ahead of time, so we pass an offset
  // and have the front/back‑end compute the absolute ts if you want it exact.
  //
  // For many demos, it's acceptable to treat "firstPaymentDueDate" as
  // "deployment time + offset" and just pass the offset directly.
  //
  const firstPaymentDueDate = m.getParameter(
    "firstPaymentDueDate",
    // NOTE: this is just a default. For more precision, set it via CLI/env.
    Math.floor(Date.now() / 1000) + Number(firstPaymentOffset)
  );

  const leaseEndDate = m.getParameter(
    "leaseEndDate",
    Number(firstPaymentDueDate) + Number(leasePeriods) * Number(paymentIntervalSeconds)
  );

  // staticCall here is overkill; better is to just call initialize directly:
  m.call(
    logicTemplate,
    "initialize",
    [
      ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "address",
        ],
        [
          rentAmount,
          paymentIntervalSeconds,
          firstPaymentDueDate,
          gracePeriodUnits,
          leaseEndDate,
          timeUnitSeconds,
          registry,
        ]
      ),
    ],
    { id: "InitRentalLogic" }
  );

  return { registry, logicTemplate, vault, token };
});