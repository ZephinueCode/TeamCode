import { Effect, Schema } from "effect"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { fromSchema } from "./json-schema"

export interface ToolContext {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  callID?: string
  messages: unknown[]
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): Effect.Effect<void>
  ask(input: { permission: string; patterns: string[]; metadata: Record<string, unknown>; always: string[] }): Effect.Effect<void>
}

export interface ExecuteResult {
  title: string
  metadata: Record<string, unknown>
  output: string
}

export interface Def {
  id: string
  description: string
  parameters: any
  jsonSchema?: JSONSchema7
  execute(args: unknown, ctx: ToolContext): Effect.Effect<ExecuteResult, never, never>
}

export interface Info {
  id: string
  init: () => Effect.Effect<Def, never, never>
}

export function define(
  id: string,
  def: Omit<Def, "id"> | (() => Effect.Effect<Omit<Def, "id">, never, never>),
): Effect.Effect<Info, never, never> & { id: string } {
  // Generate JSON Schema eagerly if the tool provides Schema parameters
  let jsonSchema: JSONSchema7 | undefined
  if (typeof def === "object" && def.parameters && typeof def.parameters === "object") {
    try {
      jsonSchema = isJsonSchema(def.parameters)
        ? def.parameters as JSONSchema7
        : fromSchema(def.parameters)
    } catch {}
  }

  const info: Info = {
    id,
    init: () => {
      if (typeof def === "function") {
        return Effect.map(def(), (resolved) => ({ ...resolved, id, jsonSchema }))
      }
      return Effect.succeed({ ...def, id, jsonSchema })
    },
  }
  const effect = Effect.succeed(info) as Effect.Effect<Info, never, never>
  return Object.assign(effect, { id })
}

export function init(info: Info): Effect.Effect<Def, never, never> {
  return info.init()
}

function isJsonSchema(value: unknown): value is JSONSchema7 {
  return typeof value === "object"
    && value !== null
    && ("type" in value || "properties" in value || "required" in value || "$schema" in value)
}
