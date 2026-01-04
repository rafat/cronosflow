import "server-only";
import { AgentPlan, AgentPlanSchema } from "./schemas";
import {
  toolSyncState,
  toolCreatePaymentRequest,
  toolCommitDistribution,
  toolTriggerDefaultCheck,
  recordAgentRun,
} from "./tools";

function simplePolicy(state: Awaited<ReturnType<typeof toolSyncState>>): AgentPlan {
  const { schedule, preview, vault } = state;

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const steps = [] as AgentPlan["steps"];

  const due = nowSec >= schedule.nextPaymentDueDate;
  const idle = vault.totalIdle;
  const expected = schedule.expectedPeriodicPayment;

  // If payment due and vault idle < expected -> create x402 payment request
  if (due && idle < expected) {
    steps.push({
      tool: "createPaymentRequest",
      args: {},
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
  // TODO: integrate Crypto.com AI Agent SDK here:
  //  - pass state as tool input / context
  //  - let agent propose steps (syncState already executed)
  //  - validate with AgentPlanSchema
  return simplePolicy(state);
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
        const dueAt = new Date(
          Number(synced.schedule.nextPaymentDueDate) * 1000,
        );
        const out = await toolCreatePaymentRequest(
          assetId,
          synced.schedule.expectedPeriodicPayment,
          dueAt,
        );
        actions.push({ tool: step.tool, args: step.args, output: out });
      }

      if (step.tool === "commitDistribution") {
        const out = await toolCommitDistribution(assetId);
        actions.push({ tool: step.tool, args: step.args, output: out });
      }

      if (step.tool === "triggerDefaultCheck") {
        const out = await toolTriggerDefaultCheck(assetId);
        actions.push({ tool: step.tool, args: step.args, output: out });
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
    await recordAgentRun({
      assetId,
      mode,
      plan: null,
      actions,
      result: "FAILED",
      error: e?.message ?? String(e),
    });
    return { ok: false, error: e?.message ?? String(e) };
  }
}