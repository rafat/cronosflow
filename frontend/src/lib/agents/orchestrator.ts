import "server-only";
import { AgentPlan, AgentPlanSchema } from "./schemas";
import {
  toolSyncState,
  toolCreatePaymentRequest,
  toolCommitDistribution,
  toolTriggerDefaultCheck,
  recordAgentRun,
} from "./tools";
import { systemPrompt } from "./prompts";
import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function simplePolicy(state: Awaited<ReturnType<typeof toolSyncState>>): AgentPlan {
  const { schedule, preview, vault } = state;

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const steps = [] as AgentPlan["steps"];

  // Convert bigint to number for comparison for now, assuming values fit.
  // In a real-world scenario, careful handling of BigInt comparison is needed.
  const nextPaymentDueDateNum = Number(schedule.nextPaymentDueDate);
  const nowNum = Number(nowSec);
  const idleNum = Number(vault.totalIdle);
  const expectedNum = Number(schedule.expectedPeriodicPayment);

  const due = nowNum >= nextPaymentDueDateNum;
  const idle = vault.totalIdle;
  const expected = schedule.expectedPeriodicPayment;

  // If payment due and vault idle < expected -> create x402 payment request
  if (due && idle < expected) {
    steps.push({
      tool: "createPaymentRequest",
      args: {
        amount: expected.toString(), // Pass as string for bigint
        dueAt: new Date(nextPaymentDueDateNum * 1000).toISOString(),
      },
      why: "Payment is due and idle funds are insufficient; need to request tenant/payment via x402.",
    });
  }

  // If idle >= expected and asset is active -> commit distribution
  if (idle >= expected) {
    steps.push({
      tool: "commitDistribution",
      args: {},
      why: "Idle funds are enough to cover expected payment; commit to distribution.",
    });
  }

  // If in grace/late/default bucket -> trigger default check
  const health = preview.cashflowHealth;
  // CashflowHealth enum: 0=PERFORMING,1=GRACE_PERIOD,2=LATE,3=DEFAULTED,4=COMPLETED
  if (health === 1 || health === 2 || health === 3) {
    steps.push({
      tool: "triggerDefaultCheck",
      args: {},
      why: "Asset is in non-performing health; run registry checkAndTriggerDefault.",
    });
  }

  return {
    reasoning: "Deterministic policy based on schedule, idle funds, and cashflow health.",
    steps,
  };
}

// Placeholder for Crypto.com AI Agent SDK-based planning:
// You can replace simplePolicy with a call to the SDK that returns a JSON plan
// matching AgentPlanSchema.
async function generatePlanWithCryptoAgent(
  assetId: string,
  state: Awaited<ReturnType<typeof toolSyncState>>,
): Promise<AgentPlan> {
  // Pass the state as a string, handling BigInt conversion for the LLM
  const userMessageContent = `Current asset state for assetId ${assetId}:\n\`\`\`json\n${JSON.stringify(state, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  )}\n\`\`\``;

  const response = await openai.chat.completions.create({
    model: "gpt-4o", // or another suitable model
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userMessageContent,
      },
    ],
    temperature: 0.7,
    response_format: { type: "json_object" },
  });

  const rawPlan = JSON.parse(response.choices[0].message.content || "{}");
  const plan = AgentPlanSchema.parse(rawPlan);
  return plan;
}

export async function runAgentForAsset(assetId: string, mode: "manual" | "cron") {
  const actions: any[] = [];

  try {
    // Step 1: sync state
    const synced = await toolSyncState(assetId);
    actions.push({ tool: "syncState", output: synced });

    // Step 2: get plan (LLM/Agent or deterministic)
    const rawPlan = await generatePlanWithCryptoAgent(assetId, synced);
    const plan = AgentPlanSchema.parse(rawPlan);

    // Step 3: execute steps
    for (const step of plan.steps) {
      if (step.tool === "createPaymentRequest") {
        const { amount, dueAt } = step.args;
        if (typeof amount !== 'string' || typeof dueAt !== 'string') {
          throw new Error("Invalid arguments for createPaymentRequest: amount and dueAt must be strings.");
        }
        const out = await toolCreatePaymentRequest(
          assetId,
          BigInt(amount), // Convert back to BigInt
          new Date(dueAt),
        );
        actions.push({ tool: step.tool, args: step.args, output: out });
      } else if (step.tool === "commitDistribution") {
        const out = await toolCommitDistribution(assetId);
        actions.push({ tool: step.tool, args: step.args, output: out });
      } else if (step.tool === "triggerDefaultCheck") {
        const out = await toolTriggerDefaultCheck(assetId);
        actions.push({ tool: step.tool, args: step.args, output: out });
      } else {
        console.warn(`Unknown tool: ${step.tool}. Skipping.`);
        actions.push({ tool: step.tool, args: step.args, output: { status: "skipped", reason: "unknown tool" } });
      }
    }

    await recordAgentRun({
      assetId,
      mode,
      plan,
      actions,
      result: "SUCCESS",
    });

    return { ok: true, plan, actions };
  } catch (e: any) {
    console.error("Agent run failed:", e);
    await recordAgentRun({
      assetId,
      mode,
      plan: null, // Plan might not have been generated or parsed successfully
      actions,
      result: "FAILED",
      error: e?.message ?? String(e),
    });
    return { ok: false, error: e?.message ?? String(e) };
  }
}