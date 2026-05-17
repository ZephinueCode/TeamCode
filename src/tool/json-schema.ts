/**
 * Generate JSON Schema from Effect Schema for AI SDK tool validation.
 * Replicates OpenCode's tool/json-schema.ts approach.
 */
import type { JSONSchema7 } from "@ai-sdk/provider"
import { Schema } from "effect"

const cache = new WeakMap<object, JSONSchema7>()

export function fromSchema(schema: any): JSONSchema7 {
  const hit = cache.get(schema)
  if (hit) return hit

  // Try Effect's JSON Schema export (available in 4.0-beta via Schema namespace)
  try {
    // Effect 4.0-beta has Schema.toJSONSchema or JSONSchema.from
    const jsonSchemaMod = (Schema as any).JSONSchema
    const doc = jsonSchemaMod?.from?.(schema, { additionalProperties: true })
      ?? (Schema as any).toJsonSchemaDocument?.(schema)
      ?? (Schema as any).toJSONSchema?.(schema)

    if (doc?.schema) {
      const result: JSONSchema7 = { ...doc.schema } as any
      delete (result as any).$schema
      cache.set(schema, result)
      return result
    }
  } catch {}

  // Extract fields from Schema.Struct for a basic JSON schema
  try {
    const ast = schema?.ast
    if (ast?.propertySignatures) {
      const properties: Record<string, any> = {}
      const required: string[] = []
      for (const [key, prop] of Object.entries(ast.propertySignatures) as any) {
        const type = prop?.type ?? prop
        if (type?._tag === "StringKeyword") properties[key] = { type: "string" }
        else if (type?._tag === "NumberKeyword") properties[key] = { type: "number" }
        else if (type?._tag === "BooleanKeyword") properties[key] = { type: "boolean" }
        else properties[key] = {}
        // Check if required (not optional)
        if (!type?.isOptional) required.push(key)
      }
      const result: JSONSchema7 = { type: "object", properties, required: required.length > 0 ? required : undefined } as any
      cache.set(schema, result)
      return result
    }
  } catch {}

  const fallback: JSONSchema7 = { type: "object", properties: {}, additionalProperties: true }
  cache.set(schema, fallback)
  return fallback
}
