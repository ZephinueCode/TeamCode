import { Schema } from "effect"

export const ModelConfig = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  endpoint: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  temperature: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
})

export const DeliberationConfig = Schema.Struct({
  maxRounds: Schema.optional(Schema.Number),
  mode: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
})

export const ExecutionConfig = Schema.Struct({
  pmReview: Schema.optional(Schema.String),
  maxReviewRounds: Schema.optional(Schema.Number),
  interruptOnBlocker: Schema.optional(Schema.Boolean),
  coderAutonomy: Schema.optional(Schema.String),
})

export const CompactionConfig = Schema.Struct({
  auto: Schema.optional(Schema.Boolean),
  tailTurns: Schema.optional(Schema.Number),
  reservedTokens: Schema.optional(Schema.Number),
  committeeTemplate: Schema.optional(Schema.Boolean),
  contextLimit: Schema.optional(Schema.Number),
  overflowRatio: Schema.optional(Schema.Number),
})

export const Info = Schema.Struct({
  models: Schema.Struct({
    pm: ModelConfig,
    coder: ModelConfig,
    intern: Schema.optional(ModelConfig),
  }),
  committee: Schema.optional(
    Schema.Struct({
      deliberation: Schema.optional(DeliberationConfig),
      execution: Schema.optional(ExecutionConfig),
      compaction: Schema.optional(CompactionConfig),
    }),
  ),
  permission: Schema.optional(
    Schema.Struct({
      pm: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      coder: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      intern: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
  skills: Schema.optional(
    Schema.Struct({
      paths: Schema.optional(Schema.Array(Schema.String)),
      urls: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
})

export type Info = Schema.Schema.Type<typeof Info>
export type ModelConfig = Schema.Schema.Type<typeof ModelConfig>

export const defaults: Info = {
  models: {
    pm:    { provider: "openai-compatible", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com", temperature: 0.5, maxTokens: 65536 },
    coder: { provider: "openai-compatible", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com", temperature: 0.5, maxTokens: 65536 },
    intern:{ provider: "openai-compatible", model: "deepseek-v4-flash", endpoint: "https://api.deepseek.com", temperature: 0.1, maxTokens: 16384 },
  },
  committee: {
    deliberation: { maxRounds: 3, mode: "consensus" as const, timeout: 600000 },
    execution: { pmReview: "async" as const, maxReviewRounds: 2, interruptOnBlocker: true, coderAutonomy: "full" as const },
    compaction: { auto: true, tailTurns: 2, reservedTokens: 20000, committeeTemplate: true, contextLimit: 200000, overflowRatio: 0.75 },
  },
}
