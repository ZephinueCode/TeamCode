/**
 * Runtime config — mutable overrides for model settings.
 * Slash commands (/pm, /coder, /intern) modify these at runtime.
 * These override the file-based config without writing to disk.
 */
import type { ModelConfig } from "../committee/config"

export interface RuntimeOverride {
  model?: string
  endpoint?: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

class RuntimeConfig {
  private overrides: Record<string, RuntimeOverride> = {}

  get(agent: string, base: ModelConfig): Required<Pick<ModelConfig, "model" | "endpoint">> & ModelConfig {
    const ov = this.overrides[agent] ?? {}
    return {
      ...base,
      model: ov.model ?? base.model,
      endpoint: ov.endpoint ?? base.endpoint ?? "",
      apiKey: ov.apiKey ?? base.apiKey,
      temperature: ov.temperature ?? base.temperature,
      maxTokens: ov.maxTokens ?? base.maxTokens,
    }
  }

  set(agent: string, patch: RuntimeOverride) {
    this.overrides[agent] = { ...this.overrides[agent], ...patch }
  }

  getOverride(agent: string): RuntimeOverride {
    return this.overrides[agent] ?? {}
  }

  reset(agent: string) {
    delete this.overrides[agent]
  }
}

export const runtimeConfig = new RuntimeConfig()
