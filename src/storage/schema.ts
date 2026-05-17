import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const session = sqliteTable("session", {
  id: text().primaryKey(),
  slug: text().notNull(),
  project_id: text().notNull(),
  parent_id: text(),
  directory: text().notNull(),
  title: text().notNull(),
  agent: text(),
  model_provider: text(),
  model_id: text(),
  cost: integer().notNull().default(0),
  tokens_input: integer().notNull().default(0),
  tokens_output: integer().notNull().default(0),
  tokens_reasoning: integer().notNull().default(0),
  tokens_cache_read: integer().notNull().default(0),
  tokens_cache_write: integer().notNull().default(0),
  permission: text(),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
  time_archived: integer(),
})

export const message = sqliteTable("message", {
  id: text().primaryKey(),
  session_id: text().notNull().references(() => session.id, { onDelete: "cascade" }),
  parent_id: text(),
  role: text({ enum: ["user", "assistant"] }).notNull(),
  agent: text().notNull(),
  model_provider: text().notNull(),
  model_id: text().notNull(),
  cost: integer().notNull().default(0),
  tokens_input: integer().notNull().default(0),
  tokens_output: integer().notNull().default(0),
  tokens_reasoning: integer().notNull().default(0),
  tokens_cache_read: integer().notNull().default(0),
  tokens_cache_write: integer().notNull().default(0),
  finish: text(),
  error: text(),
  summary: integer().default(0),
  time_created: integer().notNull(),
  time_completed: integer(),
})

export const part = sqliteTable("part", {
  id: text().primaryKey(),
  session_id: text().notNull().references(() => session.id, { onDelete: "cascade" }),
  message_id: text().notNull().references(() => message.id, { onDelete: "cascade" }),
  type: text({ enum: ["text", "reasoning", "tool", "step_start", "step_finish", "patch", "compaction", "file"] }).notNull(),
  data: text().notNull(), // JSON blob
})

export const committeeEvent = sqliteTable("committee_event", {
  id: text().primaryKey(),
  session_id: text().notNull().references(() => session.id, { onDelete: "cascade" }),
  phase: text({ enum: ["pm_planning", "coder_review", "deliberation", "consensus", "execution", "intern_task"] }).notNull(),
  role: text({ enum: ["pm", "coder", "intern", "system"] }).notNull(),
  content: text().notNull(),
  metadata: text(),
  time_created: integer().notNull(),
})

export const compactionSnapshot = sqliteTable("compaction_snapshot", {
  id: text().primaryKey(),
  session_id: text().notNull().references(() => session.id, { onDelete: "cascade" }),
  pm_context: text().notNull(),
  coder_context: text().notNull(),
  shared_consensus: text().notNull(),
  token_count: integer().notNull(),
  time_created: integer().notNull(),
})
