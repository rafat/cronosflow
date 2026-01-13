// frontend/src/lib/utils/currency.ts

import { marketDataClient } from "@/src/lib/market_data/client";

/**
 * Converts a fiat amount to a token amount using an FX rate.
 * This is a conceptual helper. In a real application, you'd need to consider
 * token decimals, slippage, and possibly integrate with on-chain price oracles.
 *
 * @param fiatAmount The amount in fiat currency (e.g., USD).
 * @param fromCurrency The fiat currency symbol (e.g., "USD").
 * @param toTokenSymbol The symbol of the target token (e.g., "USDC", "CRO").
 * @returns The converted token amount as a BigInt.
 */
export async function convertFiatToTokenAmount(
  fiatAmount: number,
  fromCurrency: string,
  toTokenSymbol: string,
  tokenDecimals: number = 18, // Common default, adjust based on actual token
): Promise<bigint> {
  const fxRate = await marketDataClient.getFxRate(fromCurrency, toTokenSymbol);

  // Simple conversion: fiatAmount * fxRate
  // In a real scenario, this would involve more sophisticated handling
  // of token decimals and precision.
  const rawTokenAmount = fiatAmount * fxRate;

  // Convert to BigInt considering token decimals.
  // This is a simplified approach and might need adjustment for precision.
  const multiplier = BigInt(10) ** BigInt(tokenDecimals);
  const tokenAmount = BigInt(Math.round(rawTokenAmount * Number(multiplier)));

  console.log(
    `Converted ${fiatAmount} ${fromCurrency} to ${tokenAmount} ${toTokenSymbol} (raw: ${rawTokenAmount}) using FX rate ${fxRate}.`
  );

  return tokenAmount;
}
