import { Effect, Layer, Context } from "effect"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { Service as ConfigService } from "../config/config"
import { runtimeConfig } from "../config/runtime"

export interface ModelHandle {
  id: string
  providerID: string
  language: ReturnType<ReturnType<typeof createOpenAICompatible>["chatModel"]>
}

export interface Interface {
  readonly pm: Effect.Effect<ModelHandle, never, never>
  readonly coder: Effect.Effect<ModelHandle, never, never>
  readonly intern: Effect.Effect<ModelHandle, never, never>
}

export class Service extends Context.Service<Service, Interface>()("@teamcode/Provider") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configSvc = yield* ConfigService
    const cfg = yield* configSvc.get()

    // No caching — runtime config can change model/endpoint/key at any time
    function resolve(id: string): ModelHandle {
      const effective = runtimeConfig.get(id, cfg.models[id as "pm" | "coder"] ?? cfg.models.pm)
      const provider = createOpenAICompatible({
        name: id,
        baseURL: effective.endpoint,
        apiKey: effective.apiKey ?? "not-needed",
      })
      return { id: effective.model, providerID: id, language: provider.chatModel(effective.model) }
    }

    return Service.of({
      pm: Effect.sync(() => resolve("pm")),
      coder: Effect.sync(() => resolve("coder")),
      intern: Effect.sync(() => {
        const ic = cfg.models.intern
        return resolve(ic?.endpoint && ic.model ? "intern" : "pm")
      }),
    })
  }),
)
