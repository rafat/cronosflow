const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

async function main() {
  // Deploy the contract
  const Logic = await ethers.getContractFactory("RentalCashFlowLogic");
  const logic = await Logic.deploy();
  
  const rentAmount = ethers.parseUnits("1000", 18);
  const paymentInterval = 30 * 24 * 60 * 60; // 30 days
  const gracePeriodDays = 5;
  const leaseEndDate = Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60; // 6 months

  const initData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "uint256", "uint256"],
    [rentAmount, paymentInterval, gracePeriodDays, leaseEndDate]
  );

  await logic.initialize(initData);

  // Test what evaluateDefault returns
  const result = await logic.evaluateDefault(Math.floor(Date.now() / 1000));
  console.log("Raw result:", result);
  console.log("Type of result:", typeof result);
  console.log("Result keys:", Object.keys(result));
  console.log("Result length:", result.length);
  console.log("Result [0]:", result[0]);
  console.log("Result [1]:", result[1]);
  console.log("Result.newStatus:", result.newStatus);
  console.log("Result.newHealth:", result.newHealth);
}

main().catch(console.error);