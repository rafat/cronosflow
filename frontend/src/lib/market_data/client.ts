// frontend/src/lib/market_data/client.ts

import "server-only";

// This is a mock MarketData client. In a real scenario, you would integrate
// with the actual Crypto.com Market Data MCP SDK or API.

export class MarketDataClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = "https://mock-market-data.example.com") {
    if (!apiKey) {
      console.warn("MarketDataClient initialized without an API key. This is fine for mocking/testing.");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Simulates fetching an FX rate between two currencies.
   * In a real implementation, this would make an API call to a market data provider.
   * @param fromCurrency The currency to convert from (e.g., "USD")
   * @param toCurrency The currency to convert to (e.g., "CRO" or "USDC")
   * @returns The exchange rate (e.g., 1.25 for USD to CRO)
   */
  async getFxRate(fromCurrency: string, toCurrency: string): Promise<number> {
    console.log(`[MarketDataClient] Fetching FX rate for ${fromCurrency}/${toCurrency}...`);

    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Mock rates
    const rates: { [key: string]: number } = {
      "USD/CRO": 0.12, // 1 USD = 0.12 CRO (example rate)
      "USD/USDC": 1.0, // 1 USD = 1 USDC
      "EUR/USDC": 1.08, // 1 EUR = 1.08 USDC
    };

    const key = `${fromCurrency.toUpperCase()}/${toCurrency.toUpperCase()}`;
    if (rates[key]) {
      return rates[key];
    }

    console.warn(`[MarketDataClient] Mock FX rate not found for ${key}. Returning 1.0.`);
    return 1.0; // Default to 1.0 if not found
  }
}

// Export a singleton instance for convenience
export const marketDataClient = new MarketDataClient(process.env.MARKET_DATA_API_KEY || "");
