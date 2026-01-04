import {
  pgTable,
  uuid,
  varchar,
  bigint,
  integer,
  jsonb,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

export const assetTypeEnum = pgEnum("asset_type", ["REAL_ESTATE", "INVOICE", "BOND", "COMMODITY"]);
export const agentRunModeEnum = pgEnum("agent_run_mode", ["manual", "cron"]);
export const agentRunResultEnum = pgEnum("agent_run_result", ["SUCCESS", "FAILED"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "CREATED",
  "SENT",
  "SETTLED",
  "FAILED",
]);

export const assets = pgTable("assets", {
  id: uuid("id").defaultRandom().primaryKey(),

  chainId: integer("chain_id").notNull(),
  onchainAssetId: bigint("onchain_asset_id", { mode: "bigint" }).notNull(),

  type: assetTypeEnum("type").notNull().default("REAL_ESTATE"),
  name: varchar("name", { length: 128 }).notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),

  originator: varchar("originator", { length: 66 }).notNull(),

  registryAddress: varchar("registry_address", { length: 66 }).notNull(),
  logicAddress: varchar("logic_address", { length: 66 }).notNull(),
  vaultAddress: varchar("vault_address", { length: 66 }).notNull(),
  tokenAddress: varchar("token_address", { length: 66 }).notNull(),
  paymentToken: varchar("payment_token", { length: 66 }).notNull(),

  ipfsMetadataHash: varchar("ipfs_metadata_hash", { length: 255 }).notNull(),
  docUrl: varchar("doc_url", { length: 255 }),

  parsedTerms: jsonb("parsed_terms").$type<{
    rentAmount: string;
    intervalDays: number;
    graceDays: number;
    months: number;
    firstDue: string;
    leaseEnd: string;
  }>(),

  creationTxs: jsonb("creation_txs").$type<Record<string, string>>(),

  statusCache: jsonb("status_cache").$type<{
    registryStatus?: string;
    cashflowHealth?: string;
    nextDueDate?: string;
    expectedPeriodicPayment?: string;
    expectedMaturityDate?: string;
  }>(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),

  mode: agentRunModeEnum("mode").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),

  plan: jsonb("plan").$type<any>(),
  actions: jsonb("actions").$type<any>(),
  result: agentRunResultEnum("result"),
  error: varchar("error", { length: 1024 }),
});

export const paymentRequests = pgTable("payment_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),

  amount: bigint("amount", { mode: "bigint" }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: paymentStatusEnum("status").notNull().default("CREATED"),

  reference: varchar("reference", { length: 128 }),
  providerPayload: jsonb("provider_payload").$type<any>(),
  settlementTxHash: varchar("settlement_tx_hash", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});