// frontend/src/lib/x402/client.ts

import "server-only";

// This is a mock X402 client. In a real scenario, you would integrate
// with the actual Crypto.com x402 facilitator SDK or API.

export interface X402PaymentRequestInput {
  assetId: string;
  amount: bigint;
  dueAt: Date;
  reference: string;
  // Add other necessary fields for the x402 facilitator
}

export interface X402PaymentRequestOutput {
  x402Id: string;
  deepLink: string; // URL for the tenant to make payment
  status: "PENDING" | "SENT" | "EXPIRED";
  // Any other data returned by the x402 facilitator
}

export class X402Client {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = "https://mock-x402-facilitator.example.com") {
    if (!apiKey) {
      console.warn("X402Client initialized without an API key. This is fine for mocking/testing.");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Simulates creating a payment request with the x402 facilitator.
   * In a real implementation, this would make an API call.
   */
  async createPaymentRequest(
    input: X402PaymentRequestInput,
  ): Promise<X402PaymentRequestOutput> {
    console.log(`[X402Client] Creating payment request for asset ${input.assetId}...`);
    console.log(`[X402Client] Amount: ${input.amount.toString()}, Due: ${input.dueAt.toISOString()}`);

    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mockX402Id = `x402-${Math.random().toString(36).substring(2, 11)}`;
    const mockDeepLink = `${this.baseUrl}/pay/${mockX402Id}`;

    return {
      x402Id: mockX402Id,
      deepLink: mockDeepLink,
      status: "SENT",
    };
  }
}

// Export a singleton instance for convenience
export const x402Client = new X402Client(process.env.X402_API_KEY || "");
