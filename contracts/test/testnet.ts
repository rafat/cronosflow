import { expect } from "chai";
import hre from "hardhat";

describe("Cronos Testnet Deployed Contracts", function () {
  it("should have the correct roles granted in RWAAssetRegistry", async function () {
    const ethers = hre.ethers;
    const DEPLOYED_ADDRESSES = {
      registry: "0xF35e93EaeE4c6dCfA24eb0BD6aE1164c8a0ffB64",
    };

    const ADMIN_ADDRESS = "0xE5d7e81226E2Ca1355F8954673eCe59Fe40fDBFd";
    const AGENT_ADDRESS = "0x09ef97ea756496cd7a8E6a045B033A17A0B2B4A0";

    const registry = await ethers.getContractAt(
      "RWAAssetRegistry",
      DEPLOYED_ADDRESSES.registry
    );

    const ASSET_FACTORY_ROLE = await registry.ASSET_FACTORY_ROLE();
    const ASSET_MANAGER_ROLE = await registry.ASSET_MANAGER_ROLE();
    const PAYMENT_COLLECTOR_ROLE = await registry.PAYMENT_COLLECTOR_ROLE();
    const COMPLIANCE_ROLE = await registry.COMPLIANCE_ROLE();

    console.log("Verifying roles for admin:", ADMIN_ADDRESS);
    expect(
      await registry.hasRole(ASSET_FACTORY_ROLE, ADMIN_ADDRESS),
      "Admin should have ASSET_FACTORY_ROLE"
    ).to.be.true;
    expect(
      await registry.hasRole(COMPLIANCE_ROLE, ADMIN_ADDRESS),
      "Admin should have COMPLIANCE_ROLE"
    ).to.be.true;

    console.log("Verifying roles for agent:", AGENT_ADDRESS);
    expect(
      await registry.hasRole(ASSET_MANAGER_ROLE, AGENT_ADDRESS),
      "Agent should have ASSET_MANAGER_ROLE"
    ).to.be.true;
    expect(
      await registry.hasRole(PAYMENT_COLLECTOR_ROLE, AGENT_ADDRESS),
      "Agent should have PAYMENT_COLLECTOR_ROLE"
    ).to.be.true;

    console.log("Role verification successful!");
  });

  it("should have the correct state in RWARevenueVault", async function () {
    const ethers = hre.ethers;
    const DEPLOYED_ADDRESSES = {
      vault: "0xFF3260a3aab725b4BbBf9A94A57A5718196E5a73",
      registry: "0xF35e93EaeE4c6dCfA24eb0BD6aE1164c8a0ffB64",
      logicTemplate: "0x0fD55d06B382C72d8b95f5Bf9Ae1682D079B79bB",
    };

    const EXPECTED_VALUES = {
      assetId: 1,
      feeRecipient: "0x3cb6A70E6B60dC5b7d614dDa937AAe170f9D3c79",
      usdcTestnet: "0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0",
    };

    const vault = await ethers.getContractAt(
      "RWARevenueVault",
      DEPLOYED_ADDRESSES.vault
    );

    console.log("Verifying state for RWARevenueVault:", DEPLOYED_ADDRESSES.vault);
    expect(await vault.logicContract()).to.equal(DEPLOYED_ADDRESSES.logicTemplate);
    expect(await vault.registry()).to.equal(DEPLOYED_ADDRESSES.registry);
    expect(await vault.assetId()).to.equal(EXPECTED_VALUES.assetId);
    expect(await vault.feeRecipient()).to.equal(EXPECTED_VALUES.feeRecipient);
    expect(await vault.paymentToken()).to.equal(EXPECTED_VALUES.usdcTestnet);
    console.log("RWARevenueVault state verification successful!");
  });

  it("should have the correct state in InvestorShareToken", async function () {
    const ethers = hre.ethers;
    const DEPLOYED_ADDRESSES = {
      token: "0xa894C0c4553969072B914DA7E1a1a223624b2530",
      registry: "0xF35e93EaeE4c6dCfA24eb0BD6aE1164c8a0ffB64",
      vault: "0xFF3260a3aab725b4BbBf9A94A57A5718196E5a73",
    };

    const ADMIN_ADDRESS = "0xE5d7e81226E2Ca1355F8954673eCe59Fe40fDBFd";

    const token = await ethers.getContractAt(
      "InvestorShareToken",
      DEPLOYED_ADDRESSES.token
    );

    console.log("Verifying state for InvestorShareToken:", DEPLOYED_ADDRESSES.token);
    expect(await token.name()).to.equal("RWA Real Estate Share");
    expect(await token.symbol()).to.equal("RWA-RES");
    expect(await token.maxSupply()).to.equal(ethers.parseEther("1000000"));
    expect(await token.assetId()).to.equal(1);
    expect(await token.registry()).to.equal(DEPLOYED_ADDRESSES.registry);
    expect(await token.vault()).to.equal(DEPLOYED_ADDRESSES.vault);

    const ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
    const VAULT_ROLE = await token.VAULT_ROLE();

    expect(await token.hasRole(ADMIN_ROLE, ADMIN_ADDRESS)).to.be.true;
    expect(await token.hasRole(VAULT_ROLE, DEPLOYED_ADDRESSES.vault)).to.be.true;
    console.log("InvestorShareToken state verification successful!");
  });
});
