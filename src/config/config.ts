import { Effect, Layer, Context } from "effect"
import * as fs from "fs/promises"
import path from "path"
import os from "os"
import { parse as parseJsonc } from "jsonc-parser"
import { Info, defaults } from "../committee/config"
import type { Info as CommitteeConfig } from "../committee/config"

const PROJECT_FILE = "teamcode.jsonc"
const GLOBAL_DIR = path.join(os.homedir(), ".teamcode")

export interface Interface {
  readonly get: () => Effect.Effect<CommitteeConfig>
}

export class Service extends Context.Service<Service, Interface>()("@teamcode/Config") {}

function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_, name: string) => process.env[name] ?? "")
  }
  if (Array.isArray(obj)) return obj.map(substituteEnvVars)
  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = substituteEnvVars(value)
    }
    return result
  }
  return obj
}

async function findProjectConfig(startDir: string): Promise<string | undefined> {
  let dir = startDir
  const root = path.parse(dir).root
  while (dir !== root) {
    const file = path.join(dir, PROJECT_FILE)
    try { await fs.access(file); return file } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}

async function loadFile(filepath: string): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(filepath, "utf-8")
    const errors: any[] = []
    const parsed = parseJsonc(text, errors)
    if (errors.length) {
      console.warn(`Config parse warnings in ${filepath}:`, errors.map((e: any) => e.error).join(", "))
    }
    return substituteEnvVars(parsed) as Record<string, unknown>
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw e
  }
}

function deepMerge(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const out = { ...a }
  for (const key of Object.keys(b)) {
    const bv = b[key]
    if (bv === undefined) continue
    if (typeof bv === "object" && bv !== null && !Array.isArray(bv) && typeof out[key] === "object" && out[key] !== null) {
      out[key] = deepMerge(out[key], bv)
    } else {
      out[key] = bv
    }
  }
  return out
}

async function ensureGlobalConfig(): Promise<void> {
  const file = path.join(GLOBAL_DIR, PROJECT_FILE)
  try {
    await fs.access(file)
    return // file exists — never overwrite user settings
  } catch {
    // create a minimal starter file; deepMerge fills defaults for missing fields
    await fs.mkdir(GLOBAL_DIR, { recursive: true })
    await fs.writeFile(file, "{\n  // TeamCode user config — use /baseurl, /apikey, /model to configure\n}\n", "utf-8")
  }
}

async function loadAllConfigs(cwd: string): Promise<CommitteeConfig> {
  await ensureGlobalConfig()

  let result: Record<string, any> = { ...defaults }

  // Project config first (lower priority — provides project-specific defaults)
  const projectFile = await findProjectConfig(cwd)
  if (projectFile) {
    result = deepMerge(result, await loadFile(projectFile))
  }

  // Global user config on top (highest priority — slash commands persist here)
  for (const name of [PROJECT_FILE, "config.json"]) {
    result = deepMerge(result, await loadFile(path.join(GLOBAL_DIR, name)))
  }

  return result as CommitteeConfig
}

function validateConfig(cfg: CommitteeConfig): string[] {
  const issues: string[] = []
  if (!cfg.models.pm.model) issues.push("pm.model is empty")
  if (!cfg.models.coder.model) issues.push("coder.model is empty")
  return issues
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cwd = process.cwd()
    const config: CommitteeConfig = yield* Effect.promise(() => loadAllConfigs(cwd))

    const issues = validateConfig(config)
    if (issues.length) {
      console.error("\n⚠️  Configuration issues:\n")
      for (const issue of issues) console.error("  - " + issue)
      console.error("\n  Create a teamcode.jsonc in your project or ~/.teamcode/")
      console.error("  See teamcode.jsonc in the TeamCode repo for an example.\n")
    }

    return Service.of({ get: () => Effect.succeed(config) })
  }),
)

export const defaultLayer = layer
