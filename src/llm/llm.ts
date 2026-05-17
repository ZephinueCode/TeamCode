import { Effect, Layer, Context, Stream } from "effect"
import { streamText, tool, jsonSchema, type Tool as AITool, type ModelMessage, stepCountIs } from "ai"
import type { ModelHandle } from "../provider/provider"
import type { Def as ToolDef } from "../tool/tool"

export type StreamEvent = Awaited<ReturnType<typeof streamText>>["fullStream"] extends AsyncIterable<infer T> ? T : never

export interface StreamInput {
  sessionID: string
  agent: { name: string; temperature?: number }
  model: ModelHandle
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, AITool>
  maxOutputTokens?: number
  abortSignal?: AbortSignal
}

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<StreamEvent, Error>
}

export class Service extends Context.Service<Service, Interface>()("@teamcode/LLM") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      stream: (input) =>
        Stream.fromAsyncIterable(
          (async function* () {
            const abortSignal = input.abortSignal ?? new AbortController().signal
            const systemText = input.system.join("\n\n")
            const result = await streamText({
              model: input.model.language,
              system: systemText || undefined,
              messages: input.messages,
              tools: input.tools,
              toolChoice: "auto",
              maxOutputTokens: input.maxOutputTokens,
              stopWhen: stepCountIs(100),
              abortSignal,
              allowSystemInMessages: true,
            })
            for await (const event of result.fullStream) {
              yield event
            }
          })(),
          (e) => (e instanceof Error ? e : new Error(String(e))),
        ),
    })
  }),
)

export const defaultLayer = layer

export function toAITool(
  def: ToolDef,
  executor: (args: unknown, callID: string) => Promise<{ output: string; title: string; metadata: Record<string, unknown> }>,
): AITool {
  return tool({
    description: def.description,
    inputSchema: (def as any).jsonSchema ? jsonSchema((def as any).jsonSchema) : jsonSchema({ type: "object" }),
    execute: async (args, opts) => {
      return executor(args, opts.toolCallId)
    },
  })
}
