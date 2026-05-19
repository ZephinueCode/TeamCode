import { Effect, Layer, Context } from "effect"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { Service as ConfigService } from "../config/config"
import { runtimeConfig } from "../config/runtime"
import type { ModelConfig } from "../committee/config"

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

// ═══════════════════════════════════════════════════════════════
// Provider Presets
// ═══════════════════════════════════════════════════════════════
// When "provider" is set to a known name, the endpoint and API key env var
// are resolved automatically. Users only need to specify provider + model.
//
// Example config:
//   { "provider": "anthropic", "model": "claude-sonnet-4-6" }
//   { "provider": "deepseek", "model": "deepseek-v4-pro" }
//   { "provider": "openrouter", "model": "anthropic/claude-opus-4-6" }
//
// Falls back to "openai-compatible" behavior if provider is unknown.

interface ProviderPreset {
  baseURL: string
  headers?: Record<string, string>
  apiKeyEnv?: string
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  anthropic: {
    baseURL: "https://api.anthropic.com/v1",
    headers: { "anthropic-version": "2023-06-01" },
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  deepseek: {
    baseURL: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  zenmux: {
    baseURL: "https://zenmux.ai/api/v1",
    apiKeyEnv: "ZENMUX_API_KEY",
  },
  ollama: {
    baseURL: "http://localhost:11434/v1",
    apiKeyEnv: "OLLAMA_API_KEY",
  },
  "ollama-cloud": {
    baseURL: "https://ollama.com/v1",
    apiKeyEnv: "OLLAMA_CLOUD_API_KEY",
  },
  dashscope: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
  },
  together: {
    baseURL: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
  },
  fireworks: {
    baseURL: "https://api.fireworks.ai/inference/v1",
    apiKeyEnv: "FIREWORKS_API_KEY",
  },
}

function resolveProvider(agentId: string, cfg: ModelConfig): ModelHandle {
  const effective = runtimeConfig.get(agentId, cfg)
  const providerName = effective.provider ?? "openai-compatible"
  const preset = PROVIDER_PRESETS[providerName]

  let baseURL: string
  let apiKey: string
  let headers: Record<string, string> | undefined

  if (preset) {
    baseURL = effective.endpoint || preset.baseURL
    apiKey = effective.apiKey || (preset.apiKeyEnv ? process.env[preset.apiKeyEnv] ?? "" : "")
    headers = preset.headers
  } else {
    // Generic openai-compatible — user must provide endpoint
    baseURL = effective.endpoint ?? ""
    apiKey = effective.apiKey ?? process.env.TEAMCODE_API_KEY ?? ""
  }

  const provider = createOpenAICompatible({
    name: `${agentId}-${providerName}`,
    baseURL,
    apiKey: apiKey || "not-needed",
    headers,
  })

  const modelId = effective.model
  return { id: modelId, providerID: agentId, language: provider.chatModel(modelId) }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configSvc = yield* ConfigService
    const cfg = yield* configSvc.get()

    return Service.of({
      pm: Effect.sync(() => resolveProvider("pm", cfg.models.pm)),
      coder: Effect.sync(() => resolveProvider("coder", cfg.models.coder)),
      intern: Effect.sync(() => {
        const ic = cfg.models.intern
        return resolveProvider("intern", ic?.endpoint && ic.model ? ic : cfg.models.pm)
      }),
    })
  }),
)
