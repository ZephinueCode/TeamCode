import { Effect, Schema } from "effect"
import { spawn } from "cross-spawn"
import { define } from "./tool"
import type { ToolContext } from "./tool"

const ShellInput = Schema.Struct({
  command: Schema.String,
  workdir: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
})

export const ShellTool = define("shell", {
  description: "Execute a shell command in the project directory",
  parameters: ShellInput,
  execute(input, ctx) {
    return Effect.gen(function* () {
      const args = input as { command: string; workdir?: string; timeout?: number }
      if (ctx.abort.aborted) return { title: "", metadata: {}, output: "Aborted" }

      const result = yield* Effect.promise<{ stdout: string; stderr: string; code: number | null }>(() =>
        new Promise((resolve) => {
          const child = spawn(args.command, {
            shell: true,
            cwd: args.workdir ?? process.cwd(),
            timeout: args.timeout ?? 120000,
          })
          let stdout = ""
          let stderr = ""
          child.stdout?.on("data", (d: Buffer) => { stdout += d.toString() })
          child.stderr?.on("data", (d: Buffer) => { stderr += d.toString() })
          ctx.abort.addEventListener("abort", () => child.kill())
          child.on("close", (code) => resolve({ stdout, stderr, code }))
          child.on("error", (err) => resolve({ stdout, stderr: String(err), code: null }))
        }),
      )

      const output = [result.stdout, result.stderr ? `\n[stderr]\n${result.stderr}` : ""]
        .filter(Boolean).join("\n").trim()
      return {
        title: `Ran: ${args.command.slice(0, 60)}${args.command.length > 60 ? "..." : ""}`,
        output: output || `(exit code: ${result.code})`,
        metadata: { exitCode: result.code },
      }
    })
  },
})
