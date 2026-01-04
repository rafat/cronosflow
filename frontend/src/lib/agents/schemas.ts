import { z } from "zod";

export const AgentStepSchema = z.object({
  tool: z.enum([
    "syncState",
    "createPaymentRequest",       // x402 intent
    "commitDistribution",
    "triggerDefaultCheck",
  ]),
  args: z.record(z.string(), z.any()).default({}),
  why: z.string().optional(),
});

export const AgentPlanSchema = z.object({
  reasoning: z.string(),
  steps: z.array(AgentStepSchema),
});

export type AgentPlan = z.infer<typeof AgentPlanSchema>;
export type AgentStep = z.infer<typeof AgentStepSchema>;