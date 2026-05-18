/**
 * Slash commands — unified for all three agents.
 *
 *   /apikey <sk-...>    Set API key for ALL models at once
 *   /baseurl <url>      Set base URL for ALL models at once
 *   /help               Show all commands
 *   /status             Committee status
 *   /plan               Show current plan
 *   /compact            Force compaction
 *   /theme dark|light   Switch theme
 *   /exit               Quit
 */
import { runtimeConfig } from "../config/runtime"
import { persistConfig } from "../config/persist"
import type { TuiState } from "./state"

export interface SlashCommand {
  name: string
  aliases?: string[]
  description: string
  execute: (args: string, ctx: CommandContext) => string | void
}

export interface CommandContext {
  state: TuiState
  setState: (patch: Partial<TuiState>) => void
  dispatch: (action: string, payload?: unknown) => void
}

export const builtinCommands: SlashCommand[] = [
  {
    name: "baseurl",
    aliases: ["url", "endpoint"],
    description: "Set API endpoint for ALL models. /baseurl https://api.openai.com/v1",
    execute(args) {
      const url = args.trim()
      if (!url) return "Usage: /baseurl https://your-api.com/v1"
      try { new URL(url) } catch { return "Invalid URL: " + url }
      for (const a of ["pm", "coder", "intern"]) runtimeConfig.set(a, { endpoint: url })
      persistConfig({ models: { pm: { endpoint: url }, coder: { endpoint: url }, intern: { endpoint: url } } })
      return `Base URL → ${url} (pm, coder, intern) ✓ — saved to config`
    },
  },
  {
    name: "apikey",
    aliases: ["key"],
    description: "Set API key for ALL models. /apikey sk-your-key",
    execute(args) {
      const key = args.trim()
      if (!key) return "Usage: /apikey sk-your-api-key"
      for (const a of ["pm", "coder", "intern"]) {
        process.env[`TEAMCODE_${a.toUpperCase()}_API_KEY`] = key
        runtimeConfig.set(a, { apiKey: key })
      }
      persistConfig({ models: { pm: { apiKey: key }, coder: { apiKey: key }, intern: { apiKey: key } } })
      const masked = key.length > 8 ? key.slice(0, 4) + "..." + key.slice(-4) : "***"
      return `API key → ${masked} (pm, coder, intern) ✓ — saved to config`
    },
  },
  {
    name: "review",
    description: "Submit current PM discussion to Coder for review. /review",
    execute(_args, ctx) {
      ctx.dispatch("submit_to_coder")
      return "Submitting to Coder for review..."
    },
  },
  {
    name: "context",
    description: "Show or set context limit (tokens). /context | /context 200000",
    execute(args, ctx) {
      const val = parseInt(args.trim())
      if (!isNaN(val) && val > 0) {
        ctx.dispatch("set_context_limit", val)
        return `Context limit → ${val.toLocaleString()} tokens ✓`
      }
      return `Context limit: ${ctx.state.tokenUsage ? Math.round(ctx.state.tokenUsage / 1000) + 'k / ' + (ctx.state as any)._contextLimit / 1000 + 'k' : 'unknown'}`
    },
  },
  {
    name: "model",
    description: "Show or set model per agent. /model pm qwen3.6-35b-a3b",
    execute(args, ctx) {
      const parts = args.trim().split(/\s+/)
      const agent = parts[0]
      const model = parts.slice(1).join(" ")
      if (!agent || !["pm", "coder", "intern"].includes(agent)) {
        return `Usage: /model pm|coder|intern <model-name>\nPM: ${ctx.state.pmModel}\nCoder: ${ctx.state.coderModel}\nIntern: ${ctx.state.internModel ?? "n/a"}`
      }
      if (!model) return `${agent.toUpperCase()} model: ${ctx.state.pmModel}  —  /model ${agent} <name> to change`
      runtimeConfig.set(agent, { model })
      // Update display state
      if (agent === "pm") ctx.state.pmModel = model
      if (agent === "coder") ctx.state.coderModel = model
      if (agent === "intern") ctx.state.internModel = model
      ctx.dispatch("model_changed")
      // Persist to user config so it survives restarts
      persistConfig({ models: { [agent]: { model } } })
      return `${agent.toUpperCase()} model → ${model} ✓ — saved`
    },
  },
  {
    name: "help",
    aliases: ["h", "?"],
    description: "Show all available commands",
    execute() {
      const lines = ["", "  Commands:", ""]
      for (const c of builtinCommands) {
        lines.push(`  /${c.name.padEnd(10)} ${c.description}`)
      }
      lines.push("", "  Start typing / then press Enter to see matches. Use Esc to cancel.", "")
      return lines.join("\n")
    },
  },
  {
    name: "status",
    description: "Show committee status and progress",
    execute(_args, ctx) {
      const p = ctx.state.progress
      return [
        `Phase: ${ctx.state.phase}`,
        `Models: PM ${ctx.state.pmModel} | Coder ${ctx.state.coderModel} | Intern ${ctx.state.internModel ?? "n/a"}`,
        `Files: ${p.completedFiles.length} done | ${p.currentFile ?? "—"} in progress | ${p.failedFiles.length} failed`,
        `Compactions: ${ctx.state.compactionCount} | Tokens: ${Math.round(ctx.state.tokenUsage / 1000)}k`,
      ].join("\n")
    },
  },
  {
    name: "plan",
    description: "Show current plan or force re-planning",
    execute(_args, ctx) {
      if (ctx.state.currentPlan) {
        return `Plan: ${ctx.state.currentPlan.summary}\nFiles: ${ctx.state.currentPlan.files.map((f) => `${f.action} ${f.path}`).join(", ")}`
      }
      ctx.dispatch("force_planning")
      return "Requesting PM to generate a plan..."
    },
  },
  {
    name: "compact",
    description: "Force committee context compaction now",
    execute(_args, ctx) {
      ctx.dispatch("force_compaction")
      return "Compaction triggered."
    },
  },
  {
    name: "theme",
    description: "Switch theme: /theme dark | light",
    execute(args, ctx) {
      const name = args.trim() || "dark-default"
      ctx.setState({ theme: name })
      return `Theme → ${name}`
    },
  },
  {
    name: "copy",
    description: "Copy conversation to clipboard. /copy | /copy 100",
    execute(args, ctx) {
      const count = parseInt(args.trim()) || 50
      ctx.dispatch("copy", count)
      return `Copying last ${count} messages to clipboard...`
    },
  },
  {
    name: "pmreview",
    description: "Toggle PM auto-review during Coder execution. /pmreview true | false",
    execute(args, ctx) {
      const val = args.trim().toLowerCase()
      if (val === "true" || val === "on" || val === "1") {
        ctx.dispatch("pmreview", true)
        return "PM auto-review: ON"
      }
      if (val === "false" || val === "off" || val === "0") {
        ctx.dispatch("pmreview", false)
        return "PM auto-review: OFF"
      }
      return "Usage: /pmreview true | false"
    },
  },
  {
    name: "maxinterns",
    description: "Set max parallel Intern dispatches. /maxinterns 2",
    execute(args, ctx) {
      const val = parseInt(args.trim())
      if (isNaN(val) || val < 1) return "Usage: /maxinterns <number> (min 1)"
      ctx.dispatch("maxinterns", val)
      return `Max Intern batch → ${val}`
    },
  },
  {
    name: "think",
    description: "Show PM's reasoning from the current step. /think",
    execute(_args, ctx) {
      ctx.dispatch("show_reasoning")
      return ""
    },
  },
  {
    name: "stall",
    description: "Force-stop the Coder background thread. /stall",
    execute(_args, ctx) {
      ctx.dispatch("stall_coder")
      return "Coder aborted."
    },
  },
  {
    name: "exit",
    aliases: ["quit", "q"],
    description: "Exit TeamCode",
    execute(_args, ctx) {
      ctx.dispatch("exit")
      return "Goodbye."
    },
  },
]

export function matchCommands(input: string, _phase: string): SlashCommand[] {
  if (!input.startsWith("/")) return []
  const query = input.slice(1).split(/\s+/)[0]?.toLowerCase() ?? ""
  if (!query) return builtinCommands
  return builtinCommands.filter((c) => {
    const names = [c.name, ...(c.aliases ?? [])]
    return names.some((n) => n.toLowerCase().startsWith(query))
  })
}
